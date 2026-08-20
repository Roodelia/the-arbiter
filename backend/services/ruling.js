const crypto = require("crypto");
const { RAG_CONFIG } = require("../config/rag");
const { RULING_CONFIG } = require("../config/ruling");
const { CR_VERSION } = require("../config/app");
const { RULING_SYSTEM_PROMPT } = require("../prompts/ruling-system");
const { retrieveRagContext } = require("./rag");
const {
  fetchAllCardOracle,
  buildCardDataBlock,
  buildCardSummaryBlock,
  buildOfficialRulingsBlock,
  extractCardOracleTexts,
} = require("./scryfall");
const { parseRulingResponse, warnOnMissingParsedSections } = require("./ruling-parse");
const { formatRulesCitedForClient, resolveRulesCited } = require("./rules-cited");

class RulingGenerationError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = "RulingGenerationError";
    this.code = code;
    this.detail = detail;
  }
}

function buildSituationContextSection(category, situation) {
  const contextLines = [];

  if (category && situation) {
    contextLines.push(`FOCUS AREA: ${category}`);
    contextLines.push("");
    contextLines.push("GAME SITUATION:");
    contextLines.push(situation);
  } else if (category && !situation) {
    contextLines.push(`FOCUS AREA: ${category}`);
    contextLines.push("");
    contextLines.push(
      `INSTRUCTION: Analyse these cards and provide a ruling focused on '${category}'.`,
    );
  } else if (!category && situation) {
    contextLines.push("GAME SITUATION:");
    contextLines.push(situation);
  } else {
    contextLines.push(
      "INSTRUCTION: Analyse these cards and identify ALL mechanically relevant interactions. Highlight non-obvious or commonly misplayed interactions.",
    );
  }

  return contextLines.join("\n");
}

function buildRulingUserPrompt({
  cardDataBlock,
  crChunks,
  officialRulingsBlock,
  category,
  situation,
}) {
  const contextSection = buildSituationContextSection(category, situation);

  return `${cardDataBlock}

RELEVANT COMPREHENSIVE RULES (retrieved via RAG):
${crChunks}

OFFICIAL CARD RULINGS (from Scryfall):
${officialRulingsBlock}

${contextSection}`;
}

function buildRulingQueryString(cardOracleTexts, situation, category) {
  const voyQueryParts = [
    ...cardOracleTexts,
    situation?.trim() || "",
    category?.trim() || "",
  ].filter(Boolean);
  return voyQueryParts.join("\n\n");
}

async function embedRulingQuery(voyage, queryString) {
  const embedResponse = await voyage.embed({
    model: RAG_CONFIG.voyageModel,
    inputType: "query",
    input: [queryString],
  });

  const queryEmbedding = embedResponse.data?.[0]?.embedding;
  if (!queryEmbedding) {
    throw new RulingGenerationError("EMBEDDING_FAILED", embedResponse);
  }
  return queryEmbedding;
}

async function fetchVectorMatches(supabase, queryEmbedding) {
  const { data: matches, error: supabaseError } = await supabase.rpc(
    "match_rules",
    {
      query_embedding: queryEmbedding,
      match_count: RAG_CONFIG.matchCount,
    },
  );

  if (supabaseError) {
    throw new RulingGenerationError("VECTOR_SEARCH_FAILED", supabaseError);
  }

  return Array.isArray(matches) ? matches : [];
}

async function callRulingModel(anthropic, userPrompt) {
  const completion = await anthropic.messages.create({
    model: RULING_CONFIG.model,
    max_tokens: RULING_CONFIG.maxTokens,
    system: [
      {
        type: "text",
        text: RULING_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  return completion.content?.[0]?.text ?? "";
}

async function persistRagMatches(supabase, case_id, ragMatches) {
  if (!case_id || !ragMatches?.length) return;

  supabase
    .from("cases")
    .upsert({ case_id, rag_matches: ragMatches }, { onConflict: "case_id" })
    .then(() => {})
    .catch((err) => console.error("rag_matches upsert error:", err));
}

/**
 * A client-supplied case_id is only honoured if it either doesn't exist yet
 * (first write for this case) or already belongs to the caller's session —
 * otherwise a caller could pass an arbitrary case_id and overwrite another
 * session's rag_matches via the upsert in persistRagMatches. On any mismatch
 * or lookup failure we fall back to minting a fresh id rather than erroring,
 * since logging is best-effort and shouldn't block a ruling.
 */
async function resolveCaseId(supabase, clientCaseId, sessionId) {
  if (typeof clientCaseId !== "string" || !clientCaseId.trim()) {
    return crypto.randomUUID();
  }

  const { data, error } = await supabase
    .from("cases")
    .select("session_id")
    .eq("case_id", clientCaseId)
    .maybeSingle();

  if (error) {
    console.error("case_id ownership check failed:", error);
    return crypto.randomUUID();
  }
  if (!data) return clientCaseId;
  if (typeof sessionId === "string" && sessionId && data.session_id === sessionId) {
    return clientCaseId;
  }
  return crypto.randomUUID();
}

/**
 * Full /ruling pipeline: Scryfall → RAG → Claude → resolve CR citations.
 */
async function generateRuling({
  supabase,
  voyage,
  anthropic,
  cards,
  situation,
  category,
  case_id: clientCaseId,
  session_id,
}) {
  const case_id = await resolveCaseId(supabase, clientCaseId, session_id);
  const oracleData = await fetchAllCardOracle(cards);

  const cardDataBlock = buildCardDataBlock(oracleData);
  console.log("[/ruling] CARD DATA block length:", cardDataBlock.length);

  const oracleBlock = buildCardSummaryBlock(oracleData, { includeStats: true });
  const officialRulingsBlock = buildOfficialRulingsBlock(oracleData);
  const cardOracleTexts = extractCardOracleTexts(oracleData);

  const queryString = buildRulingQueryString(
    cardOracleTexts,
    situation,
    category,
  );
  const queryEmbedding = await embedRulingQuery(voyage, queryString);
  const baseMatches = await fetchVectorMatches(supabase, queryEmbedding);

  const { ragMatches, crChunks } = await retrieveRagContext({
    supabase,
    queryEmbedding,
    situation,
    cardOracleTexts,
    baseMatches,
  });

  const userPrompt = buildRulingUserPrompt({
    cardDataBlock,
    crChunks,
    officialRulingsBlock,
    category,
    situation,
  });

  const rawText = await callRulingModel(anthropic, userPrompt);
  const parsed = parseRulingResponse(rawText);
  warnOnMissingParsedSections(parsed, rawText);

  const ruling = parsed.ruling?.trim() ?? "";
  const explanation = parsed.explanation?.trim() ?? "";

  const rules_cited = parsed.rules_cited
    ? await resolveRulesCited(supabase, parsed.rules_cited)
    : [];

  const oracle_referenced = parsed.card_oracle_text_referenced?.trim()
    ? parsed.card_oracle_text_referenced.trim()
    : oracleBlock;

  if (!ruling || !explanation) {
    throw new RulingGenerationError("INVALID_RESPONSE", rawText);
  }

  await persistRagMatches(supabase, case_id, ragMatches);

  return {
    case_id,
    ruling,
    explanation,
    rules_cited: formatRulesCitedForClient(rules_cited),
    oracle_referenced,
    cr_version: CR_VERSION,
    rag_matches: ragMatches,
  };
}

module.exports = {
  RulingGenerationError,
  buildSituationContextSection,
  buildRulingUserPrompt,
  buildRulingQueryString,
  resolveCaseId,
  generateRuling,
};

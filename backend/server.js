require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const { VoyageAIClient } = require("voyageai");
const { createClient } = require("@supabase/supabase-js");
const rateLimit = require('express-rate-limit');
const CR_VERSION = process.env.CR_VERSION || "unknown";

async function sendTelegramAlert({ cards, situation, ruling }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const cardNames = Array.isArray(cards) && cards.length
    ? cards.map(c => typeof c === 'string' ? c : c.name).join(', ')
    : 'No cards';
  const situation_text = situation?.slice(0, 100) || '';
  const ruling_text = ruling?.slice(0, 600) || '';
  const text = [
    '⚖️ *New ManaJudge Case*',
    `🃏 Cards: ${cardNames}`,
    situation_text ? `📝 ${situation_text}` : '',
    ruling_text ? `\n📜 *Ruling:*\n${ruling_text}` : '',
  ].filter(Boolean).join('\n');

  await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      }),
    }
  ).catch(err => console.error('Telegram alert failed:', err));
}

const EXPANSION_BLOCKLIST = new Set(["704.5", "111.10", "205.3","703.4","607.2","800.4","113.6","112.1","104.3","807.4"]);

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

const limiterOptions = {
  windowMs: 60 * 60 * 1000,  // 1 hour window
  max: 60,                     // max 60 requests per IP per hour
  standardHeaders: true,       // return rate limit info in headers
  legacyHeaders: false,
  message: {
    error: 'Too many requests. You have reached the limit of 60 rulings per hour. Please try again later.'
  },
  handler: (req, res, next, options) => {
    res.status(429).json(options.message);
  }
};

const limiter = rateLimit(limiterOptions);

const shareLimiter = rateLimit({
  ...limiterOptions,
  skip: (req) => {
    if (req.method !== "GET") return false;
    const path = String(req.originalUrl || "").split("?")[0];
    return path === "/share/featured";
  },
});

const RULING_SYSTEM_PROMPT = `You are an expert Magic: The Gathering judge.
Your role is to provide accurate, cited rulings for game situations.

Before writing your response, reason through these passes 
internally without outputting them:

INTERNAL PASS 1 — RELEVANT ABILITIES:
List every triggered ability, static ability, and replacement 
effect on each card that could interact with the others.
Do not skip any ability even if it seems irrelevant at first.

INTERNAL PASS 2 — INTERACTION POINTS:
For each ability ask:
- Does any other card modify WHEN this triggers?
- Does any other card modify HOW MANY TIMES this triggers?
- Does any other card modify WHAT this produces?
- Does any other card modify the RESULTS of what this produces?
Work through every combination, not just the obvious ones.

INTERNAL PASS 3 — LAYER ORDER:
Apply effects in correct game order:
1. Static abilities and continuous effects first
2. Replacement effects
3. Triggered abilities in APNAP order
4. For each triggered ability, check if any doubling effects apply
5. For tokens or permanents created, re-check all triggers recursively

INTERNAL PASS 4 — CALCULATIONS:
Where quantities are involved (tokens, triggers, counters),
explicitly calculate the total showing your working:
"X triggers × Y doublers = Z total"
Account for recursive interactions where one effect feeds 
into another.

Once you have completed all internal passes, output ONLY this:

RULING: [Clear one or two sentence ruling with final numbers]
The RULING line must be consistent with and supported by the EXPLANATION.
Do not include reasoning in the RULING line that contradicts the EXPLANATION.
The RULING should state the final answer only — no mechanistic reasoning.
EXPLANATION: [Bullet points for a player at the table. One • per line, 
3-5 bullets maximum. Each bullet is one key point of reasoning. 
No pass labels or internal working.]
RULES CITED: [comma-separated rule numbers only, e.g. 702.15a, 601.2c — no rule text]
CARD ORACLE TEXT REFERENCED: [Which cards and which parts apply]

CRITICAL: Your response MUST start with "RULING:" on the very first line.
No preamble before the ruling. Do not include any pass labels or internal
calculations in the output. The player should see only the verdict
and a clean explanation.

Critical rules:
- Never assume an interaction does NOT exist without checking
- Always consider recursive interactions (A affects B which affects A)
- Show explicit calculations for any numerical results
- Only cite rule numbers from the provided context
- If genuinely uncertain, say so explicitly rather than guessing

CRITICAL INTERACTION RULES:
1. CONTROLLER IDENTITY: "You"/"your" in a spell's text always refers to its controller. When retargeted, the controller does NOT change — new targets must be legal from the original controller's perspective.
2. CAST vs ETB TIMING: "When you cast" triggers resolve BEFORE the spell resolves. "When [this] enters the battlefield" triggers happen AFTER. Never treat them as simultaneous.
3. REPLACEMENT vs TRIGGERED: Replacement effects ("instead", "as", "with") modify events as they happen, don't use the stack, and apply only once per event. Triggered abilities ("when", "whenever", "at") happen after the event and use the stack. When multiple replacement effects apply, the affected controller chooses the order.
4. LAYERS (613): Continuous effects apply in order: (1) copy, (2) control, (3) text, (4) type, (5) color, (6) abilities, (7a-d) P/T. Earlier layers always apply first regardless of timestamp.
5. STATE-BASED ACTIONS: Checked when a player would receive priority. Happen simultaneously, don't use the stack. Includes: 0 toughness, lethal damage, 0 life, legend rule, counter cancellation.
6. DOUBLERS: Token doublers are replacement effects and multiply with each other. Trigger doublers create additional stack triggers. These are different mechanics.`;

const GENERIC_SERVER_ERROR_MESSAGE =
  "Something went wrong. Please try again.";

const SHARE_APP_BASE = "https://manajudge.com";

function generateShareId() {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}

/** Original client IP behind proxies (e.g. Railway). Prefer X-Forwarded-For first hop, then req.ip. */
function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  if (typeof req.ip === "string" && req.ip.length > 0) {
    return req.ip;
  }
  return req.socket?.remoteAddress || "";
}

const app = express();
// So req.ip and rate-limit use X-Forwarded-For when behind Railway / reverse proxies
app.set("trust proxy", 1);
const port = process.env.PORT || 3000;

app.use(cors({
  origin: [
    'http://localhost:8081',
    'http://192.168.86.27:8081',  
    'https://the-arbiter-production.up.railway.app',
    'https://manajudge.com',
    'https://the-arbiter-steel.vercel.app'
  ]
}));
app.use(express.json());

// Rate limit: /categories, /ruling, /log, /share (GET /share/featured excluded)
app.use('/categories', limiter);
app.use('/ruling', limiter);
app.use('/log', limiter);
app.use("/share", shareLimiter);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

async function fetchCardOracle(cardName) {
  const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(
    cardName,
  )}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Scryfall error for "${cardName}": ${res.statusText}`);
    }
    const data = await res.json();

    let officialRulings = [];
    try {
      // Be polite to Scryfall: delay between requests.
      await new Promise((resolve) => setTimeout(resolve, 100));

      const cardId = data?.id;
      if (cardId) {
        const rulingsRes = await fetch(
          `https://api.scryfall.com/cards/${cardId}/rulings`
        );
        if (rulingsRes.ok) {
          const rulings_data = await rulingsRes.json();
          officialRulings = Array.isArray(rulings_data?.data)
            ? rulings_data.data
                .filter((r) => r?.source === "wotc")
                .map((r) => r?.comment)
                .filter((comment) => typeof comment === "string")
            : [];
        }
      }
    } catch (rulingsErr) {
      // If official rulings fail, continue without them.
      officialRulings = [];
    }

    return {
      name: data.name,
      oracle_text: data.oracle_text || "",
      type_line: data.type_line || "",
      power: data.power || null,
      toughness: data.toughness || null,
      image_uri:
        data.image_uris?.normal ||
        data.image_uris?.large ||
        data.card_faces?.[0]?.image_uris?.normal ||
        null,
      rulings: officialRulings,
    };
  } catch (err) {
    console.error("Error fetching Scryfall oracle:", { cardName, error: err });
    throw err;
  }
}

function buildOracleBlock(oracleData, { includeStats = false } = {}) {
  return oracleData
    .map((c) => {
      const stats =
        includeStats && c.power != null && c.toughness != null
          ? ` (${c.power}/${c.toughness})`
          : "";
      const rulingsBlock =
        c.rulings && c.rulings.length > 0
          ? "\nOfficial Rulings:\n" + c.rulings.map((r) => `• ${r}`).join("\n")
          : "";
      return `${c.name}${stats}\n${c.type_line}\n${c.oracle_text}${rulingsBlock}`;
    })
    .join("\n\n");
}

async function fetchAllCardOracle(cards) {
  const oracleData = [];
  for (const cardName of cards) {
    const cardInfo = await fetchCardOracle(cardName);
    oracleData.push(cardInfo);
  }
  return oracleData;
}

/** Strips optional ``` / ```json fences Haiku sometimes wraps JSON in. */
function normalizeClaudeJsonText(text) {
  const s = String(text ?? "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  return s;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * CR rows from embed_rules use "702. Keyword Abilities — Rule 702.3a: …" or "Rule 104.1: …".
 * For API responses we return only the cited rule number and the substantive text.
 */
function stripCrRuleDisplayPrefix(ruleNumber, ruleTextFromDb) {
  const raw = String(ruleTextFromDb ?? "");
  const num = String(ruleNumber ?? "").trim();
  if (!num || !raw.trim()) return raw.trim();

  const esc = escapeRegExp(num);
  const withSection = new RegExp(`^.*? — Rule ${esc}:\\s*`);
  let rest = raw.replace(withSection, "");
  if (rest === raw) {
    const ruleOnly = new RegExp(`^Rule ${esc}:\\s*`);
    rest = raw.replace(ruleOnly, "");
  }
  const out = rest.trim();
  return out.length > 0 ? out : raw.trim();
}

function formatRulesCitedForClient(rulesCited) {
  if (!Array.isArray(rulesCited)) return rulesCited;
  return rulesCited.map((entry) => {
    if (typeof entry !== "string") return entry;
    const sep = ": ";
    const idx = entry.indexOf(sep);
    if (idx === -1) return entry;
    const num = entry.slice(0, idx).trim();
    const body = entry.slice(idx + sep.length);
    const cleaned = stripCrRuleDisplayPrefix(num, body);
    return `${num}: ${cleaned}`;
  });
}

app.post("/categories", async (req, res) => {
  const { cards } = req.body || {};

  if (!Array.isArray(cards) || cards.length === 0) {
    return res
      .status(400)
      .json({ error: "cards must be a non-empty string array" });
  }

  try {
    const oracleData = await fetchAllCardOracle(cards);

    const systemPrompt = `You are an expert Magic: The Gathering judge. Given card oracle texts, identify the most relevant SPECIFIC interaction categories a player would likely need a ruling on when these cards are on the battlefield together or being cast in sequence.

Rules for generating categories:
- Focus on card-to-card INTERACTIONS, not individual card mechanics in isolation
- Be specific: "Loyalty counter doubling" not "Counters", "ETB trigger timing with flash" not "Triggered abilities"
- Think about what causes confusion or disputes at the table with these specific cards
- If cards share a mechanic, call out the specific interaction (e.g., "Multiple replacement effects on damage")
- For a single card, focus on the most commonly misunderstood or disputed aspects of that card

Respond ONLY with a valid JSON array of 3-5 short category label strings. No preamble, no markdown, just the raw JSON array.`;

    const oracleBlock = buildOracleBlock(oracleData, { includeStats: false });

    const userContent = `Here are the cards and their oracle texts:

${oracleBlock}

What specific interactions or ruling questions would players most likely need help with when playing these cards together? Return only a JSON array of 3-5 specific category labels.`;

    const completion = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
    });

    const rawText =
      completion.content && completion.content[0]
        ? completion.content[0].text
        : "";

    let categories;
    try {
      const jsonText = normalizeClaudeJsonText(rawText);
      categories = JSON.parse(jsonText);
      if (!Array.isArray(categories)) {
        throw new Error("Parsed categories is not an array");
      }
      categories = categories.map((c) =>
        typeof c === "string" ? c.replace(/_/g, " ") : c,
      );
    } catch (parseErr) {
      console.error("Failed to parse categories JSON from Claude:", {
        rawText,
        error: parseErr,
      });
      return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
    }

    return res.json({ categories });
  } catch (err) {
    console.error("Error in /categories handler:", err);
    return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
  }
});

app.post("/ruling", async (req, res) => {
  const { cards, situation, category, case_id } = req.body || {};

  if (!Array.isArray(cards) || cards.length === 0) {
    return res
      .status(400)
      .json({ error: "cards must be a non-empty string array" });
  }

  try {
    const oracleData = await fetchAllCardOracle(cards);

    const oracleBlock = buildOracleBlock(oracleData, { includeStats: true });

    const cardOracleTexts = oracleData
      .map((c) => (typeof c.oracle_text === "string" ? c.oracle_text.trim() : ""))
      .filter(Boolean);

    const voyQueryParts = [
      ...cardOracleTexts,
      situation?.trim() || "",
      category?.trim() || "",
    ].filter(Boolean);
    const queryString = voyQueryParts.join("\n\n");

    const embedResponse = await voyage.embed({
      model: "voyage-3.5",
      inputType: "query",
      input: [queryString],
    });

    const queryEmbedding = embedResponse.data?.[0]?.embedding;

    if (!queryEmbedding) {
      console.error("Voyage embedding missing or malformed:", embedResponse);
      return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
    }

    const { data: matches, error: supabaseError } = await supabase.rpc(
      "match_rules",
      {
        query_embedding: queryEmbedding,
        match_count: 8,
      },
    );

    if (supabaseError) {
      console.error("Supabase match_rules error:", supabaseError);
      return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
    }

    const baseMatches = Array.isArray(matches) ? matches : [];
    const mergedByRuleNumber = new Map();
    for (const m of baseMatches) {
      const ruleNumber = m?.rule_number || m?.rule;
      if (ruleNumber && !mergedByRuleNumber.has(ruleNumber)) {
        const { embedding: _dropEmbed, ...rest } = m;
        mergedByRuleNumber.set(ruleNumber, {
          ...rest,
          rule_number: ruleNumber,
          similarity: m.similarity ?? null,
          expanded: false,
        });
      }
    }

    const topHits = baseMatches.slice(0, 3);
    for (const hit of topHits) {
      const hitRuleNumber = hit?.rule_number || hit?.rule;
      if (!hitRuleNumber) continue;

      let parentRuleNumber = hit?.parent_rule_number || null;
      if (!parentRuleNumber) {
        const { data: parentLookupRows } = await supabase
          .from("comprehensive_rules")
          .select("parent_rule_number")
          .eq("rule_number", hitRuleNumber)
          .limit(1);
        parentRuleNumber = parentLookupRows?.[0]?.parent_rule_number || null;
      }

      const skipExpansion = parentRuleNumber
        ? EXPANSION_BLOCKLIST.has(parentRuleNumber)
        : EXPANSION_BLOCKLIST.has(hitRuleNumber);
      if (skipExpansion) {
        continue;
      }

      let familyRows = [];
      if (parentRuleNumber) {
        const { data } = await supabase
          .from("comprehensive_rules")
          .select("rule_number, rule_text, embedding, parent_rule_number")
          .or(`parent_rule_number.eq.${parentRuleNumber},rule_number.eq.${parentRuleNumber}`);
        familyRows = Array.isArray(data) ? data : [];
      } else {
        const { data } = await supabase
          .from("comprehensive_rules")
          .select("rule_number, rule_text, embedding, parent_rule_number")
          .eq("parent_rule_number", hitRuleNumber);
        familyRows = Array.isArray(data) ? data : [];
      }

      const reranked = familyRows
        .filter((row) => row.embedding)
        .map((row) => ({
          ...row,
          similarity: cosineSimilarity(queryEmbedding, row.embedding),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);

      const cleanedRows = reranked.map(({ embedding, ...rest }) => ({
        ...rest,
        expanded: true,
      }));

      for (const row of cleanedRows) {
        if (!row?.rule_number) continue;
        if (!mergedByRuleNumber.has(row.rule_number)) {
          mergedByRuleNumber.set(row.rule_number, row);
        }
      }
    }

    const finalRules = Array.from(mergedByRuleNumber.values()).sort((a, b) => {
      const aRule = String(a?.rule_number || a?.rule || "");
      const bRule = String(b?.rule_number || b?.rule || "");
      return aRule.localeCompare(bRule);
    });

    const ragMatches = finalRules.map((rule) => ({
      rule_number: rule.rule_number || rule.rule || "",
      similarity: rule.similarity ?? null,
      expanded: rule.expanded ?? false,
    }));

    const crChunks = finalRules
      .map((m, idx) => {
        const ruleNumber = m.rule_number || m.rule || `Rule ${idx + 1}`;
        const text = m.rule_text || m.text || "";
        return `${ruleNumber}: ${text}`;
      })
      .join("\n\n");

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

    const contextSection = contextLines.join("\n");

    const userPrompt = `RELEVANT COMPREHENSIVE RULES (retrieved via RAG):
${crChunks}

CARD ORACLE TEXT (from Scryfall):
${oracleBlock}

${contextSection}`;

    const completion = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
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

    const rawText =
      completion.content && completion.content[0]
        ? completion.content[0].text
        : "";
    
    const rulingHeader = "RULING:";
    let textForRulingParse = rawText;
    if ((textForRulingParse.split(rulingHeader).length - 1) > 1) {
      const lastRulingIdx = textForRulingParse.lastIndexOf(rulingHeader);
      if (lastRulingIdx >= 0) {
        textForRulingParse = textForRulingParse.slice(lastRulingIdx);
      }
    }

    const rulingMatch = textForRulingParse.match(
      /RULING:\s*([\s\S]*?)\nEXPLANATION:/,
    );
    const explanationMatch = textForRulingParse.match(
      /EXPLANATION:\s*([\s\S]*?)\nRULES CITED:/,
    );
    const rulesMatch = textForRulingParse.match(
      /RULES CITED:\s*([\s\S]*?)\nCARD ORACLE TEXT REFERENCED:/,
    );
    const oracleRefMatch = textForRulingParse.match(
      /CARD ORACLE TEXT REFERENCED:\s*([\s\S]*)/,
    );

    const ruling = rulingMatch ? rulingMatch[1].trim() : "";
    const explanation = explanationMatch ? explanationMatch[1].trim() : "";

    let rules_cited = [];
    if (rulesMatch) {
      const rawRulesBlock = rulesMatch[1] || "";
      const parsedRuleNumbers = Array.from(
        new Set(
          rawRulesBlock
            .split(/[\n,;]+/)
            .map((part) =>
              part
                .replace(/^[\s•\-*]+/, "")
                .replace(/^rules?\s*cited\s*:\s*/i, "")
                .trim(),
            )
            .filter(Boolean),
        ),
      );

      if (parsedRuleNumbers.length > 0) {
        const { data: exactRules, error: rulesLookupError } = await supabase
          .from("comprehensive_rules")
          .select("rule_number, rule_text")
          .in("rule_number", parsedRuleNumbers);

        if (rulesLookupError) {
          console.error("Error looking up exact rules:", rulesLookupError);
        }

        const ruleMap = Object.fromEntries(
          (exactRules ?? []).map((r) => [r.rule_number, r.rule_text]),
        );

        rules_cited = parsedRuleNumbers.map((num) => {
          const text = ruleMap[num];
          return text ? `${num}: ${text}` : num;
        });

        const unmatched = parsedRuleNumbers.filter((num) => !ruleMap[num]);
        for (const num of unmatched) {
          const { data: fuzzyRows, error: fuzzyError } = await supabase
            .from("comprehensive_rules")
            .select("rule_number, rule_text")
            .like("rule_number", `${num}%`)
            .limit(1);

          if (fuzzyError) {
            console.error("Error looking up fuzzy rule match:", {
              rule_number: num,
              error: fuzzyError,
            });
            continue;
          }

          if (fuzzyRows?.[0]) {
            const row = fuzzyRows[0];
            const idx = rules_cited.indexOf(num);
            if (idx !== -1) {
              rules_cited[idx] = `${row.rule_number}: ${row.rule_text}`;
            }
          }
        }
      }
    }

    const oracle_referenced = oracleRefMatch
      ? oracleRefMatch[1].trim()
      : oracleBlock;

    if (!ruling || !explanation) {
      console.error("Unexpected AI response format:", rawText);
      return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
    }

    await sendTelegramAlert({ cards: req.body.cards, situation: req.body.situation, ruling });

    if (case_id && ragMatches?.length) {
      supabase
        .from("cases")
        .upsert({ case_id, rag_matches: ragMatches }, { onConflict: "case_id" })
        .then(() => {})
        .catch((err) => console.error("rag_matches upsert error:", err));
    }

    return res.json({
      ruling,
      explanation,
      rules_cited: formatRulesCitedForClient(rules_cited),
      oracle_referenced,
      cr_version: CR_VERSION,
      rag_matches: ragMatches,
    });
  } catch (err) {
    console.error("Error in /ruling handler:", err);
    return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
  }
});

app.post("/log", async (req, res) => {
  const clientIp = getClientIp(req);
  const {
    session_id,
    case_id,
    cards,
    selected_category,
    situation,
    ruling,
    explanation,
    rules_cited,
    rag_matches,
    flagged,
    flag_reason,
  } = req.body || {};

  if (typeof session_id !== "string" || session_id.trim().length === 0) {
    return res.status(400).json({ error: "session_id is required" });
  }
  if (!Array.isArray(cards) || cards.length === 0) {
    return res.status(400).json({ error: "cards must be a non-empty string array" });
  }

  try {
    const otherFields = {
      session_id,
      cards,
      ip_address: clientIp || null,
      cr_version: CR_VERSION,
      ...(selected_category !== undefined && { selected_category }),
      ...(situation !== undefined && { situation }),
      ...(ruling !== undefined && { ruling }),
      ...(explanation !== undefined && { explanation }),
      ...(rules_cited !== undefined && { rules_cited }),
      ...(rag_matches !== undefined && { rag_matches }),
      ...(flagged !== undefined && { flagged }),
      ...(flag_reason !== undefined && { flag_reason }),
    };

    const { data, error } = await supabase
      .from("cases")
      .upsert(
        { case_id: case_id, ...otherFields },
        { onConflict: "case_id", ignoreDuplicates: false }
      )
      .select("id")
      .single();

    if (error) throw error;
    return res.json({ success: true, id: data.id });
  } catch (err) {
    console.error("Error in /log handler:", err);
    return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
  }
});

app.post("/share", async (req, res) => {
  const {
    case_id,
    cards,
    category,
    situation,
    ruling,
    explanation,
    rules_cited,
  } = req.body || {};

  if (!Array.isArray(cards) || cards.length === 0) {
    return res
      .status(400)
      .json({ error: "cards must be a non-empty string array" });
  }
  if (!ruling || typeof ruling !== "string" || !ruling.trim()) {
    return res
      .status(400)
      .json({ error: "ruling must be a non-empty string" });
  }
  if (
    case_id !== undefined &&
    case_id !== null &&
    typeof case_id !== "string"
  ) {
    return res.status(400).json({ error: "case_id must be a string" });
  }
  if (
    category !== undefined &&
    category !== null &&
    typeof category !== "string" &&
    !Array.isArray(category)
  ) {
    return res
      .status(400)
      .json({ error: "category must be a string, string array, or omitted" });
  }
  if (Array.isArray(category)) {
    if (!category.every((c) => typeof c === "string")) {
      return res
        .status(400)
        .json({ error: "category array must contain only strings" });
    }
  }
  if (
    situation !== undefined &&
    situation !== null &&
    typeof situation !== "string"
  ) {
    return res.status(400).json({ error: "situation must be a string" });
  }
  if (
    explanation !== undefined &&
    explanation !== null &&
    typeof explanation !== "string"
  ) {
    return res.status(400).json({ error: "explanation must be a string" });
  }
  if (
    rules_cited !== undefined &&
    rules_cited !== null &&
    !Array.isArray(rules_cited)
  ) {
    return res.status(400).json({ error: "rules_cited must be an array" });
  }

  try {
    const explanationStr =
      typeof explanation === "string" ? explanation : "";
    const rulesList = Array.isArray(rules_cited) ? rules_cited : [];

    let categoryForDb = null;
    if (Array.isArray(category)) {
      const parts = category
        .map((c) => (typeof c === "string" ? c.trim() : String(c).trim()))
        .filter(Boolean);
      categoryForDb = parts.length > 0 ? JSON.stringify(parts) : null;
    } else if (typeof category === "string" && category.trim().length > 0) {
      categoryForDb = category.trim();
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      const shareId = generateShareId();
      const row = {
        id: shareId,
        case_id:
          typeof case_id === "string" && case_id.trim().length > 0
            ? case_id.trim()
            : null,
        cards,
        category: categoryForDb,
        situation:
          typeof situation === "string" && situation.length > 0
            ? situation
            : null,
        ruling: ruling.trim(),
        explanation: explanationStr,
        rules_cited: rulesList,
        cr_version: CR_VERSION,
      };

      const { error } = await supabase.from("shared_rulings").insert(row);

      if (!error) {
        return res.json({
          success: true,
          id: shareId,
          url: `${SHARE_APP_BASE}/ruling/${shareId}`,
        });
      }

      if (error.code !== "23505") {
        console.error("Error inserting shared_ruling:", error);
        return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
      }
    }

    console.error("Could not allocate unique share id after retries");
    return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
  } catch (err) {
    console.error("Error in /share handler:", err);
    return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
  }
});

app.get("/share/featured", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("shared_rulings")
      .select("*")
      .eq("featured", true)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) throw error;
    return res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error("Error in GET /share/featured:", err);
    return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
  }
});

app.get("/share/:id", async (req, res) => {
  const id = req.params.id;

  if (typeof id !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(id)) {
    return res.status(404).json({ error: "Ruling not found" });
  }

  try {
    const { data, error } = await supabase
      .from("shared_rulings")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: "Ruling not found" });
    }

    return res.json(data);
  } catch (err) {
    console.error("Error in GET /share/:id:", err);
    return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
  }
});

app.get("/", (req, res) => {
  res.send("ManaJudge backend is running.");
});

app.listen(port, () => {
  console.log(`ManaJudge backend listening on port ${port}`);
});

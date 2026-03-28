require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const { VoyageAIClient } = require("voyageai");
const { createClient } = require("@supabase/supabase-js");
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour window
  max: 120,                    // max 120 requests per IP per hour
  standardHeaders: true,       // return rate limit info in headers
  legacyHeaders: false,
  message: {
    error: 'Too many requests. You have reached the limit of 120 rulings per hour. Please try again later.'
  },
  handler: (req, res, next, options) => {
    res.status(429).json(options.message);
  }
});

const FLAGGED_RULINGS_PATH = path.join(__dirname, "flagged_rulings.jsonl");

const RULING_SYSTEM_PROMPT = `You are an expert Magic: The Gathering judge assistant.
Your role is to provide accurate, cited rulings for game situations.

When analysing interactions, use this multi-pass approach:

PASS 1 — IDENTIFY ALL RELEVANT ABILITIES:
List every triggered ability, static ability, and replacement 
effect on each card that could interact with the others.
Do not skip any ability even if it seems irrelevant at first.

PASS 2 — IDENTIFY INTERACTION POINTS:
For each ability identified, ask:
- Does any other card modify WHEN this triggers?
- Does any other card modify HOW MANY TIMES this triggers?
- Does any other card modify WHAT this produces?
- Does any other card modify the RESULTS of what this produces?
Work through every combination, not just the obvious ones.

PASS 3 — RESOLVE IN LAYER ORDER:
Apply effects in the correct game order:
1. Static abilities and continuous effects first
2. Replacement effects
3. Triggered abilities in APNAP order
4. For each triggered ability, check if any doubling effects apply
5. For tokens or permanents created, re-check all triggers

PASS 4 — CALCULATE TOTALS:
Where quantities are involved (tokens, triggers, counters),
explicitly calculate the total. Show your working like:
"X triggers × Y doublers = Z total"
Account for recursive interactions where one effect feeds 
into another.

PASS 5 — STATE THE RULING:
Only after completing all passes, state the final ruling.

CRITICAL: Your response MUST start with "RULING:" on the 
very first line. No preamble before the ruling.

Before writing your response, reason through these passes 
internally without outputting them:

INTERNAL PASS 1 — RELEVANT ABILITIES:
Identify every triggered ability, static ability and 
replacement effect on each card that could interact.

INTERNAL PASS 2 — INTERACTION POINTS:
For each ability ask: does any other card modify when this 
triggers, how many times it triggers, what it produces, 
or what the results produce?

INTERNAL PASS 3 — LAYER ORDER:
Apply effects in correct game order. For each trigger check 
if doubling effects apply. For tokens created, re-check all 
triggers recursively.

INTERNAL PASS 4 — CALCULATIONS:
Calculate exact totals showing your working:
"X triggers × Y doublers = Z total"

Once you have completed all internal passes, output ONLY this:

RULING: [Clear one or two sentence ruling with final numbers]
The RULING line must be consistent with and supported by the EXPLANATION.
Do not include reasoning in the RULING line that contradicts the EXPLANATION.
The RULING should state the final answer only — no mechanistic reasoning.
EXPLANATION: [Bullet points for a player at the table. One • per line, 
3-5 bullets maximum. Each bullet is one key point of reasoning. 
No pass labels or internal working.]
RULES CITED: [Rule numbers and descriptions, one per line]
CARD ORACLE TEXT REFERENCED: [Which cards and which parts apply]

Do not include any pass labels or internal calculations 
in the output. The player should see only the verdict 
and a clean explanation.

Critical rules:
- Never assume an interaction does NOT exist without checking
- Always consider recursive interactions (A affects B which affects A)
- Show explicit calculations for any numerical results
- Only cite rule numbers from the provided context
- If genuinely uncertain, say so explicitly rather than guessing

CRITICAL INTERACTION RULES:
1. CONTROLLER IDENTITY: "You"/"your" in a spell's text always refers to its controller. When retargeted (Deflecting Swat, Redirect), the controller does NOT change — new targets must be legal from the original controller's perspective.
2. CAST vs ETB TIMING: "When you cast" triggers resolve BEFORE the spell resolves. "When [this] enters the battlefield" triggers happen AFTER. Never treat them as simultaneous.
3. REPLACEMENT vs TRIGGERED: Replacement effects ("instead", "as", "with") modify events as they happen, don't use the stack, and apply only once per event. Triggered abilities ("when", "whenever", "at") happen after the event and use the stack. When multiple replacement effects apply, the affected controller chooses the order.
4. LAYERS (613): Continuous effects apply in order: (1) copy, (2) control, (3) text, (4) type, (5) color, (6) abilities, (7a-d) P/T. Earlier layers always apply first regardless of timestamp.
5. STATE-BASED ACTIONS: Checked when a player would receive priority. Happen simultaneously, don't use the stack. Includes: 0 toughness, lethal damage, 0 life, legend rule, counter cancellation.
6. DOUBLERS: Token doublers (Doubling Season, Parallel Lives) are replacement effects and multiply with each other. Trigger doublers (Panharmonicon, Yarok) create additional stack triggers. These are different mechanics.`;

const GENERIC_SERVER_ERROR_MESSAGE =
  "Something went wrong. Please try again.";

const SHARE_APP_BASE = "https://the-arbiter-steel.vercel.app";

function generateShareId() {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: [
    'http://localhost:8081',
    'http://192.168.86.27:8081',  
    'https://the-arbiter-production.up.railway.app',
    'https://the-arbiter-steel.vercel.app'
  ]
}));
app.use(express.json());

// Apply to /categories and /ruling endpoints only
app.use('/categories', limiter);
app.use('/ruling', limiter);
app.use('/log', limiter);
app.use('/share', limiter);

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

app.post("/categories", async (req, res) => {
  const { cards } = req.body || {};

  if (!Array.isArray(cards) || cards.length === 0) {
    return res
      .status(400)
      .json({ error: "cards must be a non-empty string array" });
  }

  try {
    const oracleData = [];
    for (const cardName of cards) {
      const cardInfo = await fetchCardOracle(cardName);
      oracleData.push(cardInfo);
    }

    const systemPrompt =
      "You are an expert Magic: The Gathering judge. Given card oracle texts, identify the most relevant interaction categories a player might want to ask about. Respond ONLY with a valid JSON array of 3-5 short category label strings. No preamble, no markdown, just the raw JSON array.";

    const oracleBlock = oracleData
      .map((c) => {
        const rulingsBlock =
          c.rulings && c.rulings.length > 0
            ? "\nOfficial Rulings:\n" +
              c.rulings.map((r) => `• ${r}`).join("\n")
            : "";

        return `${c.name}\n${c.type_line}\n${c.oracle_text}${rulingsBlock}`;
      })
      .join("\n\n");

    const userContent = `Here are the cards and their oracle texts:\n\n${oracleBlock}\n\nReturn only a JSON array of 3-5 short category labels.`;

    const completion = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
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
      categories = JSON.parse(rawText);
      if (!Array.isArray(categories)) {
        throw new Error("Parsed categories is not an array");
      }
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
  const { cards, situation, category } = req.body || {};

  if (!Array.isArray(cards) || cards.length === 0) {
    return res
      .status(400)
      .json({ error: "cards must be a non-empty string array" });
  }

  try {
    const oracleData = [];
    for (const cardName of cards) {
      const cardInfo = await fetchCardOracle(cardName);
      oracleData.push(cardInfo);
    }

    const oracleBlock = oracleData
      .map((c) => {
        const stats = c.power != null ? ` (${c.power}/${c.toughness})` : '';
        const rulingsBlock =
          c.rulings && c.rulings.length > 0
            ? "\nOfficial Rulings:\n" +
              c.rulings.map((r) => `• ${r}`).join("\n")
            : "";
        return `${c.name}${stats}\n${c.type_line}\n${c.oracle_text}${rulingsBlock}`;
      })
      .join("\n\n");

    const keywords = oracleData
      .map((c) => `${c.name} ${c.type_line} ${c.oracle_text}`)
      .join(" ");

    const queryParts = [cards.join(", "), keywords];
    if (category) queryParts.push(`Category: ${category}`);
    if (situation) queryParts.push(`Situation: ${situation}`);
    const queryString = queryParts.join("\n\n");

    const embedResponse = await voyage.embed({
      model: "voyage-3.5",
      inputType: "query",
      input: [queryString],
    });

    const embedding = embedResponse.data?.[0]?.embedding;

    if (!embedding) {
      console.error("Voyage embedding missing or malformed:", embedResponse);
      return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
    }

    const { data: matches, error: supabaseError } = await supabase.rpc(
      "match_rules",
      {
        query_embedding: embedding,
        match_count: 8,
      },
    );

    if (supabaseError) {
      console.error("Supabase match_rules error:", supabaseError);
      return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
    }

    console.log("RAG MATCHES:", JSON.stringify(matches?.map(m => ({
      rule: m.rule_number || m.rule,
      text: (m.rule_text || m.text || "").substring(0, 100),
      similarity: m.similarity
    })), null, 2));

    const crChunks =
      matches && Array.isArray(matches)
        ? matches
            .map((m, idx) => {
              const ruleNumber = m.rule_number || m.rule || `Rule ${idx + 1}`;
              const text = m.rule_text || m.text || "";
              return `${ruleNumber}: ${text}`;
            })
            .join("\n\n")
        : "";

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
      rules_cited = rulesMatch[1]
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }

    const oracle_referenced = oracleRefMatch
      ? oracleRefMatch[1].trim()
      : oracleBlock;

    if (!ruling || !explanation) {
      console.error("Unexpected AI response format:", rawText);
      return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
    }

    return res.json({
      ruling,
      explanation,
      rules_cited,
      oracle_referenced,
    });
  } catch (err) {
    console.error("Error in /ruling handler:", err);
    return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
  }
});

app.post("/log", async (req, res) => {
  const {
    session_id,
    case_id,
    cards,
    selected_category,
    situation,
    ruling,
    explanation,
    rules_cited,
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
      ...(selected_category !== undefined && { selected_category }),
      ...(situation !== undefined && { situation }),
      ...(ruling !== undefined && { ruling }),
      ...(explanation !== undefined && { explanation }),
      ...(rules_cited !== undefined && { rules_cited }),
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

app.post("/flag", async (req, res) => {
  const { cards, category, situation, ruling, explanation, rules_cited, reason } =
    req.body || {};

  if (!Array.isArray(cards) || cards.length === 0) {
    return res.status(400).json({ error: "cards must be a non-empty string array" });
  }
  if (!ruling || typeof ruling !== "string") {
    return res.status(400).json({ error: "ruling must be a non-empty string" });
  }

  try {
    const id = crypto.randomUUID();
    const record = {
      id,
      timestamp: new Date().toISOString(),
      cards,
      ...(category !== undefined && { category }),
      ...(situation !== undefined && { situation }),
      ruling,
      explanation: explanation ?? "",
      rules_cited: Array.isArray(rules_cited) ? rules_cited : [],
      ...(reason !== undefined && { reason }),
    };

    fs.appendFileSync(FLAGGED_RULINGS_PATH, JSON.stringify(record) + "\n", "utf8");

    return res.json({ success: true, id });
  } catch (err) {
    console.error("Error in /flag handler:", err);
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
  res.send("MTG AI Judge backend is running.");
});

app.listen(port, () => {
  console.log(`MTG AI Judge backend listening on port ${port}`);
});

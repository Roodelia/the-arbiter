require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const { VoyageAIClient } = require("voyageai");
const { createClient } = require("@supabase/supabase-js");

const FLAGGED_RULINGS_PATH = path.join(__dirname, "flagged_rulings.jsonl");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: [
    'http://localhost:8081',
    'https://the-arbiter-production.up.railway.app',
    'https://the-arbiter-steel.vercel.app'
  ]
}));
app.use(express.json());

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
    return {
      name: data.name,
      oracle_text: data.oracle_text || "",
      type_line: data.type_line || "",
      power: data.power || null,
      toughness: data.toughness || null,
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

    const userContent = `Here are the cards and their oracle texts:\n\n${JSON.stringify(
      oracleData,
      null,
      2,
    )}\n\nReturn only a JSON array of 3-5 short category labels.`;

    const completion = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      system: systemPrompt,
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
      return res
        .status(500)
        .json({ error: "Failed to parse categories from AI response" });
    }

    return res.json({ categories });
  } catch (err) {
    console.error("Error in /categories handler:", err);
    return res.status(500).json({ error: "Internal server error" });
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
        const stats =
          c.power != null && c.toughness != null
            ? ` (${c.power}/${c.toughness})`
            : "";
        return `${c.name}${stats}\n${c.type_line}\n${c.oracle_text}`;
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
      return res
        .status(500)
        .json({ error: "Failed to generate query embedding" });
    }

    const { data: matches, error: supabaseError } = await supabase.rpc(
      "match_rules",
      {
        query_embedding: embedding,
        match_count: 5,
      },
    );

    if (supabaseError) {
      console.error("Supabase match_rules error:", supabaseError);
      return res
        .status(500)
        .json({ error: "Failed to query rules from Supabase" });
    }

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

    const systemPrompt =
      "You are an expert Magic: The Gathering judge assistant. Provide accurate cited rulings. Format EXACTLY as:\nRULING: [one sentence]\nEXPLANATION: [step by step reasoning]\nRULES CITED: [rule numbers and descriptions, one per line]\nCARD ORACLE TEXT REFERENCED: [relevant card text]\nOnly cite rule numbers from the provided context. Do not make up rule numbers.";

    const completion = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
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

    const rulingMatch = rawText.match(/RULING:\s*([\s\S]*?)\nEXPLANATION:/);
    const explanationMatch = rawText.match(
      /EXPLANATION:\s*([\s\S]*?)\nRULES CITED:/,
    );
    const rulesMatch = rawText.match(
      /RULES CITED:\s*([\s\S]*?)\nCARD ORACLE TEXT REFERENCED:/,
    );
    const oracleRefMatch = rawText.match(
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
      return res
        .status(500)
        .json({ error: "Failed to parse ruling from AI response" });
    }

    return res.json({
      ruling,
      explanation,
      rules_cited,
      oracle_referenced,
    });
  } catch (err) {
    console.error("Error in /ruling handler:", err);
    return res.status(500).json({ error: "Internal server error" });
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
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/", (req, res) => {
  res.send("MTG AI Judge backend is running.");
});

app.listen(port, () => {
  console.log(`MTG AI Judge backend listening on port ${port}`);
});

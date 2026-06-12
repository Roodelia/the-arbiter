require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const { VoyageAIClient } = require("voyageai");
const { createClient } = require("@supabase/supabase-js");
const rateLimit = require('express-rate-limit');
const {
  generateRuling,
  RulingGenerationError,
} = require("./services/ruling");
const {
  CategoryGenerationError,
  generateCategories,
} = require("./services/categories");
const {
  CR_VERSION,
  GENERIC_SERVER_ERROR_MESSAGE,
  SHARE_APP_BASE,
} = require("./config/app");
const { isNonEmptyStringArray } = require("./utils/validators");

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

app.post("/categories", async (req, res) => {
  const { cards } = req.body || {};

  if (!isNonEmptyStringArray(cards)) {
    return res
      .status(400)
      .json({ error: "cards must be a non-empty string array" });
  }

  try {
    const categories = await generateCategories({ anthropic, cards });
    return res.json({ categories });
  } catch (err) {
    if (err instanceof CategoryGenerationError) {
      if (err.code === "INVALID_RESPONSE") {
        console.error("Failed to parse categories JSON from Claude:", err.detail);
      } else {
        console.error("Category generation error:", err.code, err.detail);
      }
      return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
    }
    console.error("Error in /categories handler:", err);
    return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
  }
});

app.post("/ruling", async (req, res) => {
  const { cards, situation, category, case_id } = req.body || {};

  if (!isNonEmptyStringArray(cards)) {
    return res
      .status(400)
      .json({ error: "cards must be a non-empty string array" });
  }

  try {
    const result = await generateRuling({
      supabase,
      voyage,
      anthropic,
      cards,
      situation,
      category,
      case_id,
    });

    await sendTelegramAlert({
      cards: req.body.cards,
      situation: req.body.situation,
      ruling: result.ruling,
    });

    return res.json(result);
  } catch (err) {
    if (err instanceof RulingGenerationError) {
      if (err.code === "EMBEDDING_FAILED") {
        console.error("Voyage embedding missing or malformed:", err.detail);
      } else if (err.code === "VECTOR_SEARCH_FAILED") {
        console.error("Supabase match_rules error:", err.detail);
      } else if (err.code === "INVALID_RESPONSE") {
        console.error("Unexpected AI response format:", err.detail);
      } else {
        console.error("Ruling generation error:", err.code, err.detail);
      }
      return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
    }
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
    flagged,
    flag_reason,
    source,
  } = req.body || {};

  if (typeof session_id !== "string" || session_id.trim().length === 0) {
    return res.status(400).json({ error: "session_id is required" });
  }
  if (!isNonEmptyStringArray(cards)) {
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
      // rag_matches is server-owned and written exclusively by /ruling.
      ...(flagged !== undefined && { flagged }),
      ...(flag_reason !== undefined && { flag_reason }),
      ...(source !== undefined && { source }),
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

  if (!isNonEmptyStringArray(cards)) {
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

app.get("/admin/golden-cases", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("golden_test_cases")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return res.json({ cases: Array.isArray(data) ? data : [] });
  } catch (err) {
    console.error("Error in GET /admin/golden-cases:", err);
    return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
  }
});

app.get("/admin/golden-cases/:id", async (req, res) => {
  const id = req.params.id;
  if (typeof id !== "string" || !id.trim()) {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const { data, error } = await supabase
      .from("golden_test_cases")
      .select("*")
      .eq("id", id.trim())
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: "Not found" });
    }
    return res.json({ case: data });
  } catch (err) {
    console.error("Error in GET /admin/golden-cases/:id:", err);
    return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
  }
});

app.post("/admin/golden-cases", async (req, res) => {
  const {
    cards,
    situation,
    category,
    interaction_type,
    difficulty,
    expected_verdict,
    required_rules,
    notes,
  } = req.body || {};

  if (!isNonEmptyStringArray(cards)) {
    return res
      .status(400)
      .json({ error: "cards must be a non-empty string array" });
  }
  if (!cards.every((c) => typeof c === "string")) {
    return res.status(400).json({ error: "cards must contain only strings" });
  }
  if (typeof interaction_type !== "string" || !interaction_type.trim()) {
    return res
      .status(400)
      .json({ error: "interaction_type must be a non-empty string" });
  }
  if (typeof difficulty !== "string" || !difficulty.trim()) {
    return res.status(400).json({ error: "difficulty must be a non-empty string" });
  }
  if (typeof expected_verdict !== "string" || !expected_verdict.trim()) {
    return res
      .status(400)
      .json({ error: "expected_verdict must be a non-empty string" });
  }
  if (
    situation !== undefined &&
    situation !== null &&
    typeof situation !== "string"
  ) {
    return res.status(400).json({ error: "situation must be a string" });
  }
  if (
    category !== undefined &&
    category !== null &&
    typeof category !== "string"
  ) {
    return res.status(400).json({ error: "category must be a string" });
  }
  if (required_rules !== undefined && required_rules !== null) {
    if (!Array.isArray(required_rules)) {
      return res.status(400).json({ error: "required_rules must be an array" });
    }
    if (!required_rules.every((r) => typeof r === "string")) {
      return res
        .status(400)
        .json({ error: "required_rules must contain only strings" });
    }
  }
  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    return res.status(400).json({ error: "notes must be a string" });
  }

  const row = {
    cards,
    interaction_type: interaction_type.trim(),
    difficulty: difficulty.trim(),
    expected_verdict: expected_verdict.trim(),
    ...(typeof situation === "string" && situation.length > 0
      ? { situation }
      : {}),
    ...(typeof category === "string" && category.length > 0
      ? { category }
      : {}),
    ...(Array.isArray(required_rules) && required_rules.length > 0
      ? { required_rules }
      : {}),
    ...(typeof notes === "string" && notes.length > 0 ? { notes } : {}),
  };

  try {
    const { data, error } = await supabase
      .from("golden_test_cases")
      .insert(row)
      .select("id")
      .single();

    if (error) throw error;
    if (!data || data.id === undefined || data.id === null) {
      return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
    }
    return res.json({ success: true, id: data.id });
  } catch (err) {
    console.error("Error in POST /admin/golden-cases:", err);
    return res.status(500).json({ error: GENERIC_SERVER_ERROR_MESSAGE });
  }
});

app.get("/", (req, res) => {
  res.send("ManaJudge backend is running.");
});

app.listen(port, () => {
  console.log(`ManaJudge backend listening on port ${port}`);
});

const { CATEGORY_ANCHORS } = require("../data/category-anchors");
const { buildCardSummaryBlock, fetchAllCardOracle } = require("./scryfall");
const {
  getClaudeMessageText,
  normalizeClaudeJsonText,
} = require("../utils/claude");

class CategoryGenerationError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = "CategoryGenerationError";
    this.code = code;
    this.detail = detail;
  }
}

const CATEGORIES_CONFIG = {
  model: "claude-haiku-4-5-20251001",
  maxTokens: 400,
};

function buildCategoryPrompt() {
  const anchorList = CATEGORY_ANCHORS.join(", ");
  return `You are an expert Magic: The Gathering rules judge. Given the cards and situation, identify 1–4 interaction categories that best describe what rules are at play.

ANCHOR LIST:
${anchorList}

INSTRUCTIONS:
- You MUST pick labels from the anchor list above whenever one fits.
- Prefer exact anchor phrasing (e.g. "Replacement Effects" not "replacement effect rules").
- Only use free-form labels if no anchor fits — keep them 5 words or fewer.
- Return a JSON array of strings, e.g. ["Triggered Abilities", "Layers"]
- No preamble, no explanation, only the JSON array.`;
}

function buildCategoryUserContent(oracleBlock) {
  return `Here are the cards and their oracle texts:

${oracleBlock}

What specific interactions or ruling questions would players most likely need help with when playing these cards together? Return only a JSON array of 1-4 specific category labels.`;
}

async function generateCategories({ anthropic, cards }) {
  const oracleData = await fetchAllCardOracle(cards);
  const oracleBlock = buildCardSummaryBlock(oracleData, { includeStats: false });

  const completion = await anthropic.messages.create({
    model: CATEGORIES_CONFIG.model,
    max_tokens: CATEGORIES_CONFIG.maxTokens,
    system: [
      {
        type: "text",
        text: buildCategoryPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: buildCategoryUserContent(oracleBlock),
      },
    ],
  });

  const rawText = getClaudeMessageText(completion);

  try {
    const jsonText = normalizeClaudeJsonText(rawText);
    const categories = JSON.parse(jsonText);
    if (!Array.isArray(categories)) {
      throw new Error("Parsed categories is not an array");
    }
    return categories.map((c) => (typeof c === "string" ? c.replace(/_/g, " ") : c));
  } catch (parseErr) {
    throw new CategoryGenerationError("INVALID_RESPONSE", {
      rawText,
      error: parseErr,
    });
  }
}

module.exports = {
  CategoryGenerationError,
  generateCategories,
};

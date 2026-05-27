const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSituationContextSection,
  buildRulingUserPrompt,
  buildRulingQueryString,
} = require("../services/ruling");

describe("buildSituationContextSection", () => {
  it("includes focus area and situation when both provided", () => {
    const section = buildSituationContextSection("Layers", "A copies B");
    assert.match(section, /FOCUS AREA: Layers/);
    assert.match(section, /GAME SITUATION:\nA copies B/);
  });

  it("uses deduction instruction when only cards context", () => {
    const section = buildSituationContextSection(undefined, undefined);
    assert.match(section, /identify ALL mechanically relevant interactions/);
  });
});

describe("buildRulingQueryString", () => {
  it("joins oracle text, situation, and category", () => {
    const query = buildRulingQueryString(
      ["Flying", "Haste"],
      "  on attack  ",
      "Combat Damage",
    );
    assert.equal(query, "Flying\n\nHaste\n\non attack\n\nCombat Damage");
  });
});

describe("buildRulingUserPrompt", () => {
  it("includes card data, RAG chunks, rulings, and context", () => {
    const prompt = buildRulingUserPrompt({
      cardDataBlock: "=== CARD DATA ===",
      crChunks: "702.15a: text",
      officialRulingsBlock: "Card: Bolt",
      category: "Deathtouch",
      situation: "blocks with deathtouch",
    });
    assert.match(prompt, /=== CARD DATA ===/);
    assert.match(prompt, /RELEVANT COMPREHENSIVE RULES/);
    assert.match(prompt, /702.15a: text/);
    assert.match(prompt, /OFFICIAL CARD RULINGS/);
    assert.match(prompt, /FOCUS AREA: Deathtouch/);
  });
});

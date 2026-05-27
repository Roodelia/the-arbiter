const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { parseRulingResponse } = require("../services/ruling-parse");

describe("parseRulingResponse", () => {
  it("extracts all sections when RULING appears last", () => {
    const raw = `EXPLANATION:
• First point
• Second point

RULES CITED:
702.15a, 510.1

CARD ORACLE TEXT REFERENCED:
Lightning Bolt — deals 3 damage

RULING:
The spell resolves and deals 3 damage.`;

    const parsed = parseRulingResponse(raw);
    assert.match(parsed.explanation, /First point/);
    assert.equal(parsed.rules_cited, "702.15a, 510.1");
    assert.match(parsed.card_oracle_text_referenced, /Lightning Bolt/);
    assert.equal(parsed.ruling, "The spell resolves and deals 3 damage.");
  });

  it("uses the last RULING block when multiple are present", () => {
    const raw = `RULING: Wrong answer

EXPLANATION:
• Reasoning

RULING:
Correct final answer`;

    const parsed = parseRulingResponse(raw);
    assert.equal(parsed.ruling, "Correct final answer");
    assert.match(parsed.explanation, /Reasoning/);
  });
});

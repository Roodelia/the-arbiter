const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  stripCrRuleDisplayPrefix,
  formatRulesCitedForClient,
  parseRuleNumbersFromBlock,
} = require("../services/rules-cited");

describe("stripCrRuleDisplayPrefix", () => {
  it("strips section-prefixed display text", () => {
    const body =
      "Keyword Abilities — Rule 702.15a: Deathtouch: A creature with deathtouch...";
    assert.equal(
      stripCrRuleDisplayPrefix("702.15a", body),
      "Deathtouch: A creature with deathtouch...",
    );
  });

  it("strips Rule N: prefix only", () => {
    assert.equal(
      stripCrRuleDisplayPrefix("100.1", "Rule 100.1: Game concepts"),
      "Game concepts",
    );
  });
});

describe("formatRulesCitedForClient", () => {
  it("cleans display prefixes in cited entries", () => {
    const out = formatRulesCitedForClient([
      "702.15a: Keyword Abilities — Rule 702.15a: Deathtouch text",
    ]);
    assert.equal(out[0], "702.15a: Deathtouch text");
  });
});

describe("parseRuleNumbersFromBlock", () => {
  it("parses comma and newline separated rule numbers", () => {
    const nums = parseRuleNumbersFromBlock("702.15a, 510.1\n603.2d");
    assert.deepEqual(nums, ["702.15a", "510.1", "603.2d"]);
  });

  it("strips bullets and RULES CITED label noise", () => {
    const nums = parseRuleNumbersFromBlock("RULES CITED: • 702.15a; 100.1");
    assert.deepEqual(nums, ["702.15a", "100.1"]);
  });
});

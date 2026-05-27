const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { RAG_CONFIG } = require("../config/rag");
const {
  cosineSimilarity,
  applyRetrievalAnchors,
  mergeBaseMatches,
  sortRulesForContext,
  capRagContext,
} = require("../services/rag");

describe("cosineSimilarity", () => {
  it("returns 1 for identical unit vectors", () => {
    const v = [1, 0, 0];
    assert.equal(cosineSimilarity(v, v), 1);
  });

  it("returns 0 for orthogonal vectors", () => {
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  });

  it("returns higher score for more aligned vectors", () => {
    const a = [1, 2, 3];
    const close = [1, 2, 2.9];
    const far = [-1, -2, -3];
    assert.ok(cosineSimilarity(a, close) > cosineSimilarity(a, far));
  });
});

describe("applyRetrievalAnchors", () => {
  it("returns empty array when haystack matches no patterns", () => {
    assert.deepEqual(
      applyRetrievalAnchors("cast a creature", ["flying"]),
      [],
    );
  });

  it("fires ability_loss anchor from situation text", () => {
    const matches = applyRetrievalAnchors(
      "The creature loses all abilities",
      [],
    );
    assert.ok(matches.some((m) => m.label === "ability_loss"));
    assert.ok(matches.some((m) => m.rule_number === "613.1"));
    assert.ok(matches.some((m) => m.rule_number === "613.6"));
  });

  it("fires quantity_replacement anchor from oracle text", () => {
    const matches = applyRetrievalAnchors("", [
      "Create twice that many Goblin tokens.",
    ]);
    assert.ok(matches.some((m) => m.label === "quantity_replacement"));
    assert.ok(matches.some((m) => m.rule_number === "614.1"));
  });

  it("fires additional_trigger anchor", () => {
    const matches = applyRetrievalAnchors(
      "that ability triggers an additional time",
      [],
    );
    assert.equal(matches.filter((m) => m.label === "additional_trigger").length, 1);
    assert.equal(matches.find((m) => m.label === "additional_trigger").rule_number, "603.2d");
  });

  it("is case-insensitive", () => {
    const matches = applyRetrievalAnchors("LOSES ALL ABILITIES", []);
    assert.ok(matches.some((m) => m.label === "ability_loss"));
  });
});

describe("mergeBaseMatches", () => {
  it("deduplicates by rule_number keeping first occurrence", () => {
    const map = mergeBaseMatches([
      { rule_number: "702.2", similarity: 0.9, rule_text: "A", embedding: [1] },
      { rule_number: "702.2", similarity: 0.5, rule_text: "B", embedding: [2] },
      { rule_number: "603.2d", similarity: 0.8, rule_text: "C" },
    ]);
    assert.equal(map.size, 2);
    assert.equal(map.get("702.2").rule_text, "A");
    assert.equal(map.get("702.2").similarity, 0.9);
  });

  it("accepts legacy rule field as rule_number", () => {
    const map = mergeBaseMatches([{ rule: "100.1", similarity: 0.7 }]);
    assert.equal(map.size, 1);
    assert.equal(map.get("100.1").rule_number, "100.1");
  });

  it("marks merged hits as not expanded and strips embedding from stored object", () => {
    const map = mergeBaseMatches([
      { rule_number: "100.1", similarity: 0.7, embedding: [1, 2, 3] },
    ]);
    const row = map.get("100.1");
    assert.equal(row.expanded, false);
    assert.equal("embedding" in row, false);
  });

  it("skips rows without a rule number", () => {
    const map = mergeBaseMatches([
      { similarity: 0.5 },
      { rule_number: "100.2", similarity: 0.6 },
    ]);
    assert.equal(map.size, 1);
    assert.ok(map.has("100.2"));
  });
});

describe("sortRulesForContext", () => {
  it("orders anchored before semantic before expanded", () => {
    const sorted = sortRulesForContext([
      { rule_number: "1", expanded: true, similarity: 0.99 },
      { rule_number: "2", anchored: true, similarity: 0.1 },
      { rule_number: "3", similarity: 0.95 },
      { rule_number: "4", similarity: 0.5 },
    ]);
    assert.equal(sorted[0].rule_number, "2");
    assert.equal(sorted[1].rule_number, "3");
    assert.equal(sorted[2].rule_number, "4");
    assert.equal(sorted[3].rule_number, "1");
  });

  it("sorts semantic hits by similarity descending", () => {
    const sorted = sortRulesForContext([
      { rule_number: "a", similarity: 0.5 },
      { rule_number: "b", similarity: 0.9 },
      { rule_number: "c", similarity: 0.7 },
    ]);
    assert.deepEqual(
      sorted.map((r) => r.rule_number),
      ["b", "c", "a"],
    );
  });
});

describe("capRagContext", () => {
  const cap = RAG_CONFIG.contextCap;

  it("returns input unchanged when at or under cap", () => {
    const rules = Array.from({ length: cap }, (_, i) => ({
      rule_number: `${i}`,
      similarity: 0.5,
    }));
    assert.equal(capRagContext(rules), rules);
    assert.equal(capRagContext(rules).length, cap);
  });

  it("keeps anchored and semantic first, then fills remaining slots with expanded", () => {
    const anchored = { rule_number: "613.1", anchored: true, similarity: null };
    const semantic = Array.from({ length: 8 }, (_, i) => ({
      rule_number: `sem-${i}`,
      similarity: 1 - i * 0.01,
    }));
    const expanded = Array.from({ length: 6 }, (_, i) => ({
      rule_number: `exp-${i}`,
      expanded: true,
      similarity: 0.1,
    }));
    const input = [anchored, ...semantic, ...expanded];
    const capped = capRagContext(input);

    assert.ok(capped.some((r) => r.rule_number === "613.1"));
    assert.equal(capped.length, cap);
    assert.equal(capped.filter((r) => r.expanded).length, 3);
    assert.equal(capped.filter((r) => !r.anchored && !r.expanded).length, 8);
  });

  it("keeps only anchored rules when anchored count exceeds cap", () => {
    const anchored = Array.from({ length: cap + 3 }, (_, i) => ({
      rule_number: `anc-${String(i).padStart(2, "0")}`,
      anchored: true,
    }));
    const semantic = [{ rule_number: "999.1", similarity: 0.99 }];
    const capped = capRagContext([...anchored, ...semantic]);

    assert.equal(capped.length, cap + 3);
    assert.ok(capped.every((r) => r.anchored));
    assert.ok(capped.every((r) => r.rule_number.startsWith("anc-")));
  });

  it("returns results sorted alphabetically by rule number", () => {
    const rules = Array.from({ length: cap + 2 }, (_, i) => ({
      rule_number: `${10 - i}.1`,
      similarity: 0.5,
    }));
    const capped = capRagContext(rules);
    const numbers = capped.map((r) => r.rule_number);
    const sorted = [...numbers].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(numbers, sorted);
  });
});

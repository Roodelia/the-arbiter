const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSituationContextSection,
  buildRulingUserPrompt,
  buildRulingQueryString,
  resolveCaseId,
} = require("../services/ruling");
const { createFakeSupabase } = require("./helpers/fakeSupabase");

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("resolveCaseId", () => {
  it("mints a fresh uuid without touching supabase when no client case_id is given", async () => {
    const supabase = createFakeSupabase();
    const id = await resolveCaseId(supabase, undefined, "session-a");
    assert.match(id, UUID_RE);
    assert.deepEqual(supabase.calls, []);
  });

  it("mints a fresh uuid for a blank client case_id", async () => {
    const supabase = createFakeSupabase();
    const id = await resolveCaseId(supabase, "   ", "session-a");
    assert.match(id, UUID_RE);
  });

  it("honours the client case_id when no row exists yet (first write)", async () => {
    const supabase = createFakeSupabase();
    supabase.setResult("cases", { data: null, error: null });
    const id = await resolveCaseId(supabase, "case-123", "session-a");
    assert.equal(id, "case-123");
  });

  it("honours the client case_id when the existing row's session matches", async () => {
    const supabase = createFakeSupabase();
    supabase.setResult("cases", { data: { session_id: "session-a" }, error: null });
    const id = await resolveCaseId(supabase, "case-123", "session-a");
    assert.equal(id, "case-123");
  });

  it("mints a fresh uuid when the existing row belongs to a different session", async () => {
    const supabase = createFakeSupabase();
    supabase.setResult("cases", { data: { session_id: "session-victim" }, error: null });
    const id = await resolveCaseId(supabase, "case-123", "session-attacker");
    assert.notEqual(id, "case-123");
    assert.match(id, UUID_RE);
  });

  it("mints a fresh uuid when no session_id is given but a row already exists", async () => {
    const supabase = createFakeSupabase();
    supabase.setResult("cases", { data: { session_id: "session-a" }, error: null });
    const id = await resolveCaseId(supabase, "case-123", undefined);
    assert.notEqual(id, "case-123");
  });

  it("mints a fresh uuid on lookup error rather than throwing", async () => {
    const supabase = createFakeSupabase();
    supabase.setResult("cases", { data: null, error: { message: "db down" } });
    const id = await resolveCaseId(supabase, "case-123", "session-a");
    assert.match(id, UUID_RE);
  });
});

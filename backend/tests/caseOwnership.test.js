const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { lookupCaseOwner, isOwnedBySession } = require("../services/caseOwnership");
const { createFakeSupabase } = require("./helpers/fakeSupabase");

describe("isOwnedBySession", () => {
  it("is true when sessionId matches the existing row's session_id", () => {
    assert.equal(isOwnedBySession("sess-a", "sess-a"), true);
  });

  it("is false when sessionId is a different session", () => {
    assert.equal(isOwnedBySession("sess-a", "sess-b"), false);
  });

  it("is false when sessionId is missing", () => {
    assert.equal(isOwnedBySession("sess-a", undefined), false);
    assert.equal(isOwnedBySession("sess-a", ""), false);
  });

  it("is false when the existing row has no session_id", () => {
    assert.equal(isOwnedBySession(null, "sess-a"), false);
    assert.equal(isOwnedBySession(undefined, "sess-a"), false);
  });
});

describe("lookupCaseOwner", () => {
  it("selects session_id by case_id from the cases table", async () => {
    const supabase = createFakeSupabase();
    supabase.setResult("cases", { data: { session_id: "sess-a" }, error: null });

    const result = await lookupCaseOwner(supabase, "case-1");

    assert.deepEqual(result, { data: { session_id: "sess-a" }, error: null });
    assert.deepEqual(supabase.calls, [
      { table: "cases", method: "select", args: ["session_id"] },
      { table: "cases", method: "eq", args: ["case_id", "case-1"] },
      { table: "cases", method: "maybeSingle", args: [] },
    ]);
  });
});

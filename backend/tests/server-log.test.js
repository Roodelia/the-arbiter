// Route tests for POST /log. Verifies validation, the server-owned fields
// (cr_version is server-set; rag_matches is never accepted from the client),
// and the upsert-by-case_id contract.
const test = require("node:test");
const { beforeEach } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");

process.env.CR_VERSION = "test-cr-1.0";

const { createApp } = require("../server");
const { GENERIC_SERVER_ERROR_MESSAGE } = require("../config/app");
const { createFakeSupabase } = require("./helpers/fakeSupabase");

const fakeSupabase = createFakeSupabase();
const app = createApp({
  anthropic: {},
  voyage: {},
  supabase: fakeSupabase,
});

// fakeSupabase.calls accumulates across the whole file; reset it before
// each test so call-count/arg assertions only see that test's own requests.
beforeEach(() => {
  fakeSupabase.calls.length = 0;
});

test("POST /log - 400 when session_id is missing", async () => {
  const res = await request(app)
    .post("/log")
    .send({ cards: ["Lightning Bolt"] });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /session_id is required/);
});

test("POST /log - 400 when session_id is blank", async () => {
  const res = await request(app)
    .post("/log")
    .send({ session_id: "   ", cards: ["Lightning Bolt"] });
  assert.strictEqual(res.status, 400);
});

test("POST /log - 400 when cards is missing", async () => {
  const res = await request(app)
    .post("/log")
    .send({ session_id: "sess-1", case_id: "case-1" });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /cards must be a non-empty string array/);
});

test("POST /log - 400 when case_id is missing", async () => {
  const res = await request(app)
    .post("/log")
    .send({ session_id: "sess-1", cards: ["Lightning Bolt"] });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /case_id is required/);
});

test("POST /log - 400 when case_id is blank", async () => {
  const res = await request(app)
    .post("/log")
    .send({ session_id: "sess-1", case_id: "   ", cards: ["Lightning Bolt"] });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /case_id is required/);
});

test("POST /log - 200 upserts and echoes back the new row id", async () => {
  // First .from("cases") call is the ownership lookup (no existing row),
  // second is the upsert itself.
  fakeSupabase.setResult("cases", [
    { data: null, error: null },
    { data: { id: 42 }, error: null },
  ]);

  const res = await request(app).post("/log").send({
    session_id: "sess-1",
    case_id: "case-1",
    cards: ["Lightning Bolt"],
    selected_category: "Direct Damage",
    situation: "Can I bolt the face?",
    flagged: true,
    flag_reason: "seems wrong",
    source: "user",
  });

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { success: true, id: 42 });

  const upsertCall = fakeSupabase.calls.find(
    (c) => c.table === "cases" && c.method === "upsert",
  );
  assert.ok(upsertCall, "expected an upsert call against the cases table");
  const [row, options] = upsertCall.args;
  assert.strictEqual(row.case_id, "case-1");
  assert.strictEqual(row.session_id, "sess-1");
  assert.deepStrictEqual(row.cards, ["Lightning Bolt"]);
  assert.strictEqual(row.selected_category, "Direct Damage");
  assert.strictEqual(row.flagged, true);
  assert.strictEqual(row.flag_reason, "seems wrong");
  assert.strictEqual(row.source, "user");
  // cr_version is server-owned, never accepted from the client.
  assert.strictEqual(row.cr_version, "test-cr-1.0");
  // rag_matches is server-owned and written exclusively by /ruling.
  assert.strictEqual(row.rag_matches, undefined);
  assert.deepStrictEqual(options, { onConflict: "case_id", ignoreDuplicates: false });
});

test("POST /log - 200 when the existing row already belongs to this session (repeat upsert)", async () => {
  fakeSupabase.setResult("cases", [
    { data: { session_id: "sess-1" }, error: null },
    { data: { id: 42 }, error: null },
  ]);

  const res = await request(app).post("/log").send({
    session_id: "sess-1",
    case_id: "case-1",
    cards: ["Lightning Bolt"],
    ruling: "The trigger goes on the stack.",
  });

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { success: true, id: 42 });
});

test("POST /log - 403 when case_id belongs to a different session", async () => {
  fakeSupabase.setResult("cases", { data: { session_id: "sess-victim" }, error: null });

  const res = await request(app).post("/log").send({
    session_id: "sess-attacker",
    case_id: "case-1",
    cards: ["Lightning Bolt"],
  });

  assert.strictEqual(res.status, 403);
  assert.match(res.body.error, /does not belong to this session/);
  const upsertCall = fakeSupabase.calls.find(
    (c) => c.table === "cases" && c.method === "upsert",
  );
  assert.strictEqual(upsertCall, undefined, "must not upsert into another session's row");
});

test("POST /log - client-supplied cr_version and rag_matches are ignored", async () => {
  fakeSupabase.setResult("cases", [
    { data: null, error: null },
    { data: { id: 43 }, error: null },
  ]);

  await request(app).post("/log").send({
    session_id: "sess-2",
    case_id: "case-2",
    cards: ["Fog"],
    cr_version: "client-supplied-should-be-ignored",
    rag_matches: [{ rule_number: "999.9" }],
  });

  const upsertCall = fakeSupabase.calls
    .filter((c) => c.table === "cases" && c.method === "upsert")
    .pop();
  const [row] = upsertCall.args;
  assert.strictEqual(row.cr_version, "test-cr-1.0");
  assert.strictEqual(row.rag_matches, undefined);
});

test("POST /log - 500 with generic message when the ownership lookup errors", async () => {
  fakeSupabase.setResult("cases", { data: null, error: { message: "db unavailable" } });

  const res = await request(app)
    .post("/log")
    .send({ session_id: "sess-3", case_id: "case-3", cards: ["Fog"] });

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error, GENERIC_SERVER_ERROR_MESSAGE);
});

test("POST /log - 500 with generic message when the upsert itself errors", async () => {
  fakeSupabase.setResult("cases", [
    { data: null, error: null },
    { data: null, error: { message: "db unavailable" } },
  ]);

  const res = await request(app)
    .post("/log")
    .send({ session_id: "sess-4", case_id: "case-4", cards: ["Fog"] });

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error, GENERIC_SERVER_ERROR_MESSAGE);
});

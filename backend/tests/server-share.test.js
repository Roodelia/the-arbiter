// Route tests for POST /share, GET /share/featured, GET /share/:id.
const test = require("node:test");
const { beforeEach } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");

process.env.CR_VERSION = "test-cr-1.0";

const { createApp } = require("../server");
const { GENERIC_SERVER_ERROR_MESSAGE } = require("../config/app");
const { createFakeSupabase } = require("./helpers/fakeSupabase");

const fakeSupabase = createFakeSupabase();
const trackCalls = [];
const app = createApp({
  anthropic: {},
  voyage: {},
  supabase: fakeSupabase,
  trackEvent: (...args) => trackCalls.push(args),
});

// fakeSupabase.calls/trackCalls accumulate across the whole file; reset
// before each test so call-count assertions only see that test's requests.
beforeEach(() => {
  fakeSupabase.calls.length = 0;
  trackCalls.length = 0;
});

const validBody = {
  cards: ["Lightning Bolt"],
  ruling: "You may cast Lightning Bolt targeting a player.",
};

test("POST /share - 400 when cards is missing", async () => {
  const res = await request(app)
    .post("/share")
    .send({ ruling: "Some ruling" });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /cards must be a non-empty string array/);
});

test("POST /share - 400 when ruling is missing or blank", async () => {
  const res = await request(app)
    .post("/share")
    .send({ cards: ["Fog"], ruling: "   " });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /ruling must be a non-empty string/);
});

test("POST /share - 400 when case_id is not a string", async () => {
  const res = await request(app)
    .post("/share")
    .send({ ...validBody, case_id: 123 });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /case_id must be a string/);
});

test("POST /share - 400 when category is an invalid type", async () => {
  const res = await request(app)
    .post("/share")
    .send({ ...validBody, category: 123 });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /category must be a string, string array, or omitted/);
});

test("POST /share - 400 when category array contains non-strings", async () => {
  const res = await request(app)
    .post("/share")
    .send({ ...validBody, category: ["ok", 5] });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /category array must contain only strings/);
});

test("POST /share - 400 when rules_cited is not an array", async () => {
  const res = await request(app)
    .post("/share")
    .send({ ...validBody, rules_cited: "603.3" });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /rules_cited must be an array/);
});

test("POST /share - 200 inserts a row and returns the share url", async () => {
  fakeSupabase.setResult("shared_rulings", { data: null, error: null });

  const res = await request(app).post("/share").send({
    ...validBody,
    category: ["Direct Damage", "Timing"],
    situation: "Can I bolt in response?",
    explanation: "- step one",
    rules_cited: ["603.3"],
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(typeof res.body.id, "string");
  assert.strictEqual(res.body.id.length, 8);
  assert.strictEqual(res.body.url, `https://manajudge.com/ruling/${res.body.id}`);

  const insertCall = fakeSupabase.calls.find(
    (c) => c.table === "shared_rulings" && c.method === "insert",
  );
  assert.ok(insertCall);
  const [row] = insertCall.args;
  assert.strictEqual(row.cr_version, "test-cr-1.0");
  assert.strictEqual(row.category, JSON.stringify(["Direct Damage", "Timing"]));
});

test("POST /share - tracks ruling_shared with distinct_id/consent/ip on success (not session_id)", async () => {
  fakeSupabase.setResult("shared_rulings", { data: null, error: null });

  await request(app)
    .post("/share")
    .set("X-Forwarded-For", "203.0.113.5")
    .send({
      ...validBody,
      cards: ["Lightning Bolt", "Fog"],
      distinct_id: "distinct-1",
      analytics_consent: true,
    });

  assert.strictEqual(trackCalls.length, 1);
  const [eventName, distinctId, properties, consent, ip] = trackCalls[0];
  assert.strictEqual(eventName, "ruling_shared");
  assert.strictEqual(distinctId, "distinct-1");
  assert.strictEqual(properties.card_count, 2);
  assert.strictEqual(consent, true);
  assert.strictEqual(ip, "203.0.113.5");
});

test("POST /share - does not track when the insert fails", async () => {
  fakeSupabase.setResult("shared_rulings", { data: null, error: { code: "OTHER", message: "db down" } });

  await request(app).post("/share").send({
    ...validBody,
    session_id: "sess-1",
    analytics_consent: true,
  });

  assert.strictEqual(trackCalls.length, 0);
});

test("POST /share - retries on a unique-id collision (23505) and succeeds", async () => {
  fakeSupabase.setResult("shared_rulings", [
    { data: null, error: { code: "23505" } },
    { data: null, error: null },
  ]);

  const res = await request(app).post("/share").send(validBody);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);

  const insertCalls = fakeSupabase.calls.filter(
    (c) => c.table === "shared_rulings" && c.method === "insert",
  );
  assert.strictEqual(insertCalls.length, 2);
});

test("POST /share - 500 with generic message on a non-collision insert error", async () => {
  fakeSupabase.setResult("shared_rulings", { data: null, error: { code: "OTHER", message: "db down" } });

  const res = await request(app).post("/share").send(validBody);

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error, GENERIC_SERVER_ERROR_MESSAGE);
});

test("GET /share/featured - 200 returns the row array", async () => {
  const rows = [{ id: "abc12345", cards: ["Fog"] }];
  fakeSupabase.setResult("shared_rulings", { data: rows, error: null });

  const res = await request(app).get("/share/featured");

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, rows);
});

test("GET /share/:id - 404 when id has invalid characters", async () => {
  const res = await request(app).get("/share/not-valid!");
  assert.strictEqual(res.status, 404);
});

test("GET /share/:id - 404 when not found", async () => {
  fakeSupabase.setResult("shared_rulings", { data: null, error: null });

  const res = await request(app).get("/share/abc12345");

  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error, "Ruling not found");
});

test("GET /share/:id - 200 returns the shared ruling", async () => {
  const row = { id: "abc12345", cards: ["Fog"], ruling: "No." };
  fakeSupabase.setResult("shared_rulings", { data: row, error: null });

  const res = await request(app).get("/share/abc12345");

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, row);
});

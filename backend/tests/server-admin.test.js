// Route tests for POST /admin/login and the /admin/* endpoints behind
// requireAdmin: bearer-token auth, cases/golden-cases reads, and the
// golden-cases validation rules.
const test = require("node:test");
const { beforeEach } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");

process.env.ADMIN_SECRET = "test-admin-secret";
process.env.ADMIN_PASSWORD = ""; // falls back to ADMIN_SECRET when blank

const { createApp } = require("../server");
const { GENERIC_SERVER_ERROR_MESSAGE } = require("../config/app");
const { createFakeSupabase } = require("./helpers/fakeSupabase");

const fakeSupabase = createFakeSupabase();
const app = createApp({
  anthropic: {},
  voyage: {},
  supabase: fakeSupabase,
});

const AUTH_HEADER = { Authorization: "Bearer test-admin-secret" };

beforeEach(() => {
  fakeSupabase.calls.length = 0;
});

test("POST /admin/login - 401 with wrong password", async () => {
  const res = await request(app)
    .post("/admin/login")
    .send({ password: "wrong" });
  assert.strictEqual(res.status, 401);
});

test("POST /admin/login - 200 with the correct password, returns the token", async () => {
  const res = await request(app)
    .post("/admin/login")
    .send({ password: "test-admin-secret" });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.token, "test-admin-secret");
});

test("GET /admin/cases - 401 without an Authorization header", async () => {
  const res = await request(app).get("/admin/cases");
  assert.strictEqual(res.status, 401);
});

test("GET /admin/cases - 401 with the wrong bearer token", async () => {
  const res = await request(app)
    .get("/admin/cases")
    .set("Authorization", "Bearer nope");
  assert.strictEqual(res.status, 401);
});

test("GET /admin/cases - 200 with a valid bearer token", async () => {
  const rows = [{ id: 1, cards: ["Fog"] }];
  fakeSupabase.setResult("cases", { data: rows, error: null });

  const res = await request(app).get("/admin/cases").set(AUTH_HEADER);

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { cases: rows });
});

test("GET /admin/cases/:id - 404 when not found", async () => {
  fakeSupabase.setResult("cases", { data: null, error: null });

  const res = await request(app).get("/admin/cases/999").set(AUTH_HEADER);

  assert.strictEqual(res.status, 404);
});

test("GET /admin/cases/:id - 200 when found", async () => {
  const row = { id: 7, cards: ["Fog"] };
  fakeSupabase.setResult("cases", { data: row, error: null });

  const res = await request(app).get("/admin/cases/7").set(AUTH_HEADER);

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { case: row });
});

test("GET /admin/golden-cases - 200 with a valid bearer token", async () => {
  const rows = [{ id: 1, interaction_type: "Replacement Effects" }];
  fakeSupabase.setResult("golden_test_cases", { data: rows, error: null });

  const res = await request(app).get("/admin/golden-cases").set(AUTH_HEADER);

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { cases: rows });
});

test("GET /admin/golden-cases/:id - 404 when not found", async () => {
  fakeSupabase.setResult("golden_test_cases", { data: null, error: null });

  const res = await request(app)
    .get("/admin/golden-cases/999")
    .set(AUTH_HEADER);

  assert.strictEqual(res.status, 404);
});

test("POST /admin/golden-cases - 400 when interaction_type is missing", async () => {
  const res = await request(app)
    .post("/admin/golden-cases")
    .set(AUTH_HEADER)
    .send({
      cards: ["Fog"],
      difficulty: "easy",
      expected_verdict: "It fizzles.",
    });

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /interaction_type must be a non-empty string/);
});

test("POST /admin/golden-cases - 400 when required_rules contains non-strings", async () => {
  const res = await request(app)
    .post("/admin/golden-cases")
    .set(AUTH_HEADER)
    .send({
      cards: ["Fog"],
      interaction_type: "Replacement Effects",
      difficulty: "easy",
      expected_verdict: "It fizzles.",
      required_rules: ["614.1", 5],
    });

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /required_rules must contain only strings/);
});

test("POST /admin/golden-cases - 200 inserts and returns the new id", async () => {
  fakeSupabase.setResult("golden_test_cases", { data: { id: 11 }, error: null });

  const res = await request(app)
    .post("/admin/golden-cases")
    .set(AUTH_HEADER)
    .send({
      cards: ["Fog"],
      interaction_type: "Replacement Effects",
      difficulty: "easy",
      expected_verdict: "It fizzles.",
      required_rules: ["614.1"],
    });

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { success: true, id: 11 });

  const insertCall = fakeSupabase.calls.find(
    (c) => c.table === "golden_test_cases" && c.method === "insert",
  );
  assert.ok(insertCall);
  const [row] = insertCall.args;
  assert.deepStrictEqual(row.required_rules, ["614.1"]);
});

test("POST /admin/golden-cases - 500 with generic message when supabase returns an error", async () => {
  fakeSupabase.setResult("golden_test_cases", { data: null, error: { message: "db down" } });

  const res = await request(app)
    .post("/admin/golden-cases")
    .set(AUTH_HEADER)
    .send({
      cards: ["Fog"],
      interaction_type: "Replacement Effects",
      difficulty: "easy",
      expected_verdict: "It fizzles.",
    });

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error, GENERIC_SERVER_ERROR_MESSAGE);
});

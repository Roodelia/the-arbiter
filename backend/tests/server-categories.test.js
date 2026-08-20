// Route tests for POST /categories. The Anthropic/Scryfall orchestration
// itself is unit-tested in services/categories.js's own logic; here we only
// verify server.js's request validation, response shaping, and error
// mapping by injecting a fake generateCategories into createApp.
const test = require("node:test");
const assert = require("node:assert");
const request = require("supertest");

const { createApp } = require("../server");
const { CategoryGenerationError } = require("../services/categories");
const { GENERIC_SERVER_ERROR_MESSAGE } = require("../config/app");
const { createFakeSupabase } = require("./helpers/fakeSupabase");

let categoriesImpl = async () => ["Triggered Abilities"];
const app = createApp({
  anthropic: {},
  voyage: {},
  supabase: createFakeSupabase(),
  generateCategories: (...args) => categoriesImpl(...args),
});

test("POST /categories - 400 when cards is missing", async () => {
  const res = await request(app).post("/categories").send({});
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /cards must be a non-empty string array/);
});

test("POST /categories - 400 when cards is an empty array", async () => {
  const res = await request(app).post("/categories").send({ cards: [] });
  assert.strictEqual(res.status, 400);
});

test("POST /categories - 200 returns categories from the service", async () => {
  categoriesImpl = async ({ cards }) => {
    assert.deepStrictEqual(cards, ["Lightning Bolt"]);
    return ["Direct Damage"];
  };

  const res = await request(app)
    .post("/categories")
    .send({ cards: ["Lightning Bolt"] });

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { categories: ["Direct Damage"] });
});

test("POST /categories - 500 with generic message when service throws CategoryGenerationError", async () => {
  categoriesImpl = async () => {
    throw new CategoryGenerationError("INVALID_RESPONSE", { rawText: "oops" });
  };

  const res = await request(app)
    .post("/categories")
    .send({ cards: ["Lightning Bolt"] });

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error, GENERIC_SERVER_ERROR_MESSAGE);
});

test("POST /categories - 500 with generic message on unexpected error", async () => {
  categoriesImpl = async () => {
    throw new Error("boom");
  };

  const res = await request(app)
    .post("/categories")
    .send({ cards: ["Lightning Bolt"] });

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error, GENERIC_SERVER_ERROR_MESSAGE);
});

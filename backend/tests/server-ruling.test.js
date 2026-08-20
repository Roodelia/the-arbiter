// Route tests for POST /ruling. RAG retrieval and prompt-building are
// unit-tested elsewhere; here we verify server.js's request validation,
// response shaping, and error mapping by injecting a fake generateRuling
// into createApp.
const test = require("node:test");
const { beforeEach } = require("node:test");
const assert = require("node:assert");
const request = require("supertest");

// Guard against a real Telegram alert firing if these are ever set locally.
process.env.TELEGRAM_BOT_TOKEN = "";
process.env.TELEGRAM_CHAT_ID = "";

const { createApp } = require("../server");
const { RulingGenerationError } = require("../services/ruling");
const { GENERIC_SERVER_ERROR_MESSAGE } = require("../config/app");
const { createFakeSupabase } = require("./helpers/fakeSupabase");

const sampleResult = {
  case_id: "11111111-1111-1111-1111-111111111111",
  ruling: "The trigger goes on the stack.",
  explanation: "- Step one\n- Step two",
  rules_cited: [{ rule_number: "603.3", rule_text: "603.3. ..." }],
  oracle_referenced: "Whenever this creature attacks...",
  cr_version: "test-cr-1.0",
  rag_matches: [{ rule_number: "603.3", similarity: 0.91, expanded: false, anchored: false }],
};

let rulingImpl = async () => sampleResult;
const trackCalls = [];
const app = createApp({
  anthropic: {},
  voyage: {},
  supabase: createFakeSupabase(),
  generateRuling: (...args) => rulingImpl(...args),
  trackEvent: (...args) => trackCalls.push(args),
});

beforeEach(() => {
  trackCalls.length = 0;
});

test("POST /ruling - 400 when cards is missing", async () => {
  const res = await request(app).post("/ruling").send({});
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /cards must be a non-empty string array/);
});

test("POST /ruling - 400 when cards is an empty array", async () => {
  const res = await request(app).post("/ruling").send({ cards: [] });
  assert.strictEqual(res.status, 400);
});

test("POST /ruling - 200 forwards cards/situation/category to the service and returns its result", async () => {
  rulingImpl = async ({ cards, situation, category }) => {
    assert.deepStrictEqual(cards, ["Lightning Bolt", "Fog"]);
    assert.strictEqual(situation, "Can I bolt in response to Fog?");
    assert.strictEqual(category, "Timing and Priority");
    return sampleResult;
  };

  const res = await request(app).post("/ruling").send({
    cards: ["Lightning Bolt", "Fog"],
    situation: "Can I bolt in response to Fog?",
    category: "Timing and Priority",
  });

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, sampleResult);
});

test("POST /ruling - forwards case_id/session_id to the service when provided", async () => {
  rulingImpl = async ({ case_id, session_id }) => {
    assert.strictEqual(case_id, "client-case-id");
    assert.strictEqual(session_id, "client-session-id");
    return sampleResult;
  };

  const res = await request(app).post("/ruling").send({
    cards: ["Lightning Bolt"],
    case_id: "client-case-id",
    session_id: "client-session-id",
  });

  assert.strictEqual(res.status, 200);
});

test("POST /ruling - 500 with generic message when service throws RulingGenerationError", async () => {
  rulingImpl = async () => {
    throw new RulingGenerationError("VECTOR_SEARCH_FAILED", { message: "db down" });
  };

  const res = await request(app)
    .post("/ruling")
    .send({ cards: ["Lightning Bolt"] });

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error, GENERIC_SERVER_ERROR_MESSAGE);
});

test("POST /ruling - 500 with generic message on unexpected error", async () => {
  rulingImpl = async () => {
    throw new Error("boom");
  };

  const res = await request(app)
    .post("/ruling")
    .send({ cards: ["Lightning Bolt"] });

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error, GENERIC_SERVER_ERROR_MESSAGE);
});

test("POST /ruling - tracks verdict_requested then ruling_completed, forwarding session_id/consent", async () => {
  rulingImpl = async () => sampleResult;

  await request(app).post("/ruling").send({
    cards: ["Lightning Bolt", "Fog"],
    situation: "Can I bolt in response?",
    category: "Timing",
    session_id: "sess-1",
    analytics_consent: true,
  });

  assert.strictEqual(trackCalls.length, 2);

  const [requestedEvent, requestedId, requestedProps, requestedConsent] = trackCalls[0];
  assert.strictEqual(requestedEvent, "verdict_requested");
  assert.strictEqual(requestedId, "sess-1");
  assert.strictEqual(requestedProps.card_count, 2);
  assert.strictEqual(requestedProps.has_situation, true);
  assert.strictEqual(requestedConsent, true);

  const [completedEvent, completedId, completedProps, completedConsent] = trackCalls[1];
  assert.strictEqual(completedEvent, "ruling_completed");
  assert.strictEqual(completedId, "sess-1");
  assert.strictEqual(completedProps.card_count, 2);
  assert.strictEqual(completedProps.rules_cited_count, 1);
  assert.strictEqual(completedProps.rag_match_count, 1);
  assert.strictEqual(completedProps.cr_version, "test-cr-1.0");
  assert.strictEqual(completedConsent, true);
});

test("POST /ruling - forwards analytics_consent as-is (false/omitted) rather than gating itself", async () => {
  rulingImpl = async () => sampleResult;

  await request(app).post("/ruling").send({
    cards: ["Lightning Bolt"],
    session_id: "sess-1",
    analytics_consent: false,
  });

  assert.strictEqual(trackCalls.length, 2);
  assert.strictEqual(trackCalls[0][3], false);
  assert.strictEqual(trackCalls[1][3], false);
});

test("POST /ruling - tracks ruling_failed with the error code on RulingGenerationError", async () => {
  rulingImpl = async () => {
    throw new RulingGenerationError("VECTOR_SEARCH_FAILED", { message: "db down" });
  };

  await request(app).post("/ruling").send({
    cards: ["Lightning Bolt"],
    session_id: "sess-1",
    analytics_consent: true,
  });

  assert.strictEqual(trackCalls.length, 2);
  const [event, id, props] = trackCalls[1];
  assert.strictEqual(event, "ruling_failed");
  assert.strictEqual(id, "sess-1");
  assert.strictEqual(props.error_code, "VECTOR_SEARCH_FAILED");
});

test("POST /ruling - tracks ruling_failed with UNKNOWN on an unexpected error", async () => {
  rulingImpl = async () => {
    throw new Error("boom");
  };

  await request(app).post("/ruling").send({
    cards: ["Lightning Bolt"],
    session_id: "sess-1",
    analytics_consent: true,
  });

  const [event, , props] = trackCalls[1];
  assert.strictEqual(event, "ruling_failed");
  assert.strictEqual(props.error_code, "UNKNOWN");
});

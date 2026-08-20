const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createTracker } = require("../services/mixpanel");

function fakeClient() {
  const calls = [];
  return { client: { track: (...args) => calls.push(args) }, calls };
}

describe("createTracker", () => {
  it("tracks with distinct_id merged into properties when consent is true", () => {
    const { client, calls } = fakeClient();
    const trackEvent = createTracker(client);

    trackEvent("ruling_completed", "sess-1", { card_count: 2 }, true);

    assert.equal(calls.length, 1);
    const [eventName, props] = calls[0];
    assert.equal(eventName, "ruling_completed");
    assert.deepEqual(props, { distinct_id: "sess-1", card_count: 2 });
  });

  it("does not track when consent is false", () => {
    const { client, calls } = fakeClient();
    const trackEvent = createTracker(client);

    trackEvent("ruling_completed", "sess-1", {}, false);

    assert.equal(calls.length, 0);
  });

  it("does not track when consent is undefined/omitted", () => {
    const { client, calls } = fakeClient();
    const trackEvent = createTracker(client);

    trackEvent("ruling_completed", "sess-1", {});

    assert.equal(calls.length, 0);
  });

  it("does not track when consent is truthy but not exactly true", () => {
    const { client, calls } = fakeClient();
    const trackEvent = createTracker(client);

    trackEvent("ruling_completed", "sess-1", {}, "yes");

    assert.equal(calls.length, 0);
  });

  it("does not track when distinct_id is missing or blank", () => {
    const { client, calls } = fakeClient();
    const trackEvent = createTracker(client);

    trackEvent("ruling_completed", undefined, {}, true);
    trackEvent("ruling_completed", "   ", {}, true);

    assert.equal(calls.length, 0);
  });

  it("no-ops without throwing when the client is null (analytics not configured)", () => {
    const trackEvent = createTracker(null);
    assert.doesNotThrow(() => trackEvent("ruling_completed", "sess-1", {}, true));
  });

  it("swallows errors thrown by the underlying client rather than propagating them", () => {
    const client = {
      track: () => {
        throw new Error("network down");
      },
    };
    const trackEvent = createTracker(client);
    assert.doesNotThrow(() => trackEvent("ruling_completed", "sess-1", {}, true));
  });

  it("merges ip into the tracked properties for Mixpanel's geolocation", () => {
    const { client, calls } = fakeClient();
    const trackEvent = createTracker(client);

    trackEvent("ruling_completed", "sess-1", { card_count: 2 }, true, "203.0.113.5");

    const [, props] = calls[0];
    assert.deepEqual(props, {
      distinct_id: "sess-1",
      card_count: 2,
      ip: "203.0.113.5",
    });
  });

  it("omits ip when not supplied, rather than sending an empty/undefined value", () => {
    const { client, calls } = fakeClient();
    const trackEvent = createTracker(client);

    trackEvent("ruling_completed", "sess-1", { card_count: 2 }, true);
    trackEvent("ruling_completed", "sess-1", { card_count: 2 }, true, "");
    trackEvent("ruling_completed", "sess-1", { card_count: 2 }, true, undefined);

    for (const [, props] of calls) {
      assert.equal("ip" in props, false);
    }
  });
});

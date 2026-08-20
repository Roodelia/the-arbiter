const Mixpanel = require("mixpanel");

/**
 * Binds a trackEvent function to a given Mixpanel client (or null, if
 * analytics isn't configured). Split out from the module-level singleton
 * below so tests can exercise the consent/distinct_id gating logic against
 * a fake client instead of a real Mixpanel connection.
 */
function createTracker(mixpanelClient) {
  /**
   * Fires a Mixpanel event. No-ops (never throws) when analytics isn't
   * configured, consent wasn't given, or there's no distinct_id — tracking
   * must never block or fail the request it's attached to. ManaJudge has
   * EU/CA users, so consent must be explicitly `true`, not just truthy.
   *
   * `ip` (the caller's real client IP, e.g. from getClientIp(req)) is
   * Mixpanel's reserved property for geolocation — passing it lets Mixpanel
   * derive $country_code/$city without us storing or computing geo data
   * ourselves. Omitted when not supplied, so events without a known IP
   * don't get geolocated to this server's own address instead.
   */
  return function trackEvent(eventName, distinctId, properties = {}, consent, ip) {
    if (!mixpanelClient) return;
    if (consent !== true) return;
    if (typeof distinctId !== "string" || !distinctId.trim()) return;

    try {
      mixpanelClient.track(eventName, {
        distinct_id: distinctId,
        ...properties,
        ...(typeof ip === "string" && ip ? { ip } : {}),
      });
    } catch (err) {
      console.error(`Mixpanel track error (${eventName}):`, err);
    }
  };
}

const mixpanelClient = process.env.MIXPANEL_TOKEN
  ? Mixpanel.init(process.env.MIXPANEL_TOKEN)
  : null;

const trackEvent = createTracker(mixpanelClient);

module.exports = { createTracker, trackEvent };

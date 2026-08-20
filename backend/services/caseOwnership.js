/**
 * Shared "does this session own this case_id" check, used by /ruling
 * (falls back to a fresh case_id on mismatch, via resolveCaseId) and /log
 * (rejects the write outright) so a caller can't tamper with another
 * session's case by guessing or reusing its case_id.
 */
async function lookupCaseOwner(supabase, caseId) {
  return supabase
    .from("cases")
    .select("session_id")
    .eq("case_id", caseId)
    .maybeSingle();
}

function isOwnedBySession(existingSessionId, sessionId) {
  return (
    typeof sessionId === "string" &&
    sessionId.length > 0 &&
    existingSessionId === sessionId
  );
}

module.exports = { lookupCaseOwner, isOwnedBySession };

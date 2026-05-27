/** Strips optional ``` / ```json fences Claude may wrap around JSON. */
function normalizeClaudeJsonText(text) {
  const s = String(text ?? "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  return s;
}

/** Best-effort extraction of top-level text response content. */
function getClaudeMessageText(completion) {
  return completion?.content?.[0]?.text ?? "";
}

module.exports = {
  normalizeClaudeJsonText,
  getClaudeMessageText,
};

function parseRulingResponse(rawText) {
  const text = rawText.replace(/\r\n/g, "\n");

  const SECTION_HEADERS = [
    "RULING",
    "EXPLANATION",
    "RULES CITED",
    "CARD ORACLE TEXT REFERENCED",
  ];

  const headerAlternation = SECTION_HEADERS.map((h) =>
    h.replace(/ /g, "\\s+"),
  ).join("|");
  const anyHeaderLookahead = `(?=(?:\\n|^)\\s*(?:${headerAlternation}):\\s*|$)`;

  const extract = (headerName) => {
    const headerPattern = headerName.replace(/ /g, "\\s+");
    const re = new RegExp(
      `(?:\\n|^)\\s*${headerPattern}:\\s*([\\s\\S]*?)${anyHeaderLookahead}`,
      "i",
    );
    const match = text.match(re);
    return match ? match[1].trim() : "";
  };

  const allRulingMatches = [...text.matchAll(/(?:\n|^)\s*RULING:\s*/gi)];
  let rulingText = "";
  if (allRulingMatches.length > 0) {
    const lastRulingStart = allRulingMatches[allRulingMatches.length - 1].index;
    const tail = text.slice(lastRulingStart);
    const re = new RegExp(
      `(?:\\n|^)\\s*RULING:\\s*([\\s\\S]*?)${anyHeaderLookahead}`,
      "i",
    );
    const match = tail.match(re);
    rulingText = match ? match[1].trim() : "";
  }

  return {
    ruling: rulingText,
    explanation: extract("EXPLANATION"),
    rules_cited: extract("RULES CITED"),
    card_oracle_text_referenced: extract("CARD ORACLE TEXT REFERENCED"),
  };
}

function warnOnMissingParsedSections(parsed, rawText) {
  const missingFields = Object.entries(parsed)
    .filter(([_, v]) => !v || v.length === 0)
    .map(([k]) => k);
  if (missingFields.length > 0) {
    console.warn(
      `[/ruling] Parser extracted empty sections: ${missingFields.join(", ")}. ` +
        `Raw response length: ${rawText.length}. First 200 chars: ${rawText.slice(0, 200)}`,
    );
  }
}

module.exports = { parseRulingResponse, warnOnMissingParsedSections };

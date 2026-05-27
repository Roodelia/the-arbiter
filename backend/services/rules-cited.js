function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * CR rows from embed_rules use "702. Keyword Abilities — Rule 702.3a: …" or "Rule 104.1: …".
 * For API responses we return only the cited rule number and the substantive text.
 */
function stripCrRuleDisplayPrefix(ruleNumber, ruleTextFromDb) {
  const raw = String(ruleTextFromDb ?? "");
  const num = String(ruleNumber ?? "").trim();
  if (!num || !raw.trim()) return raw.trim();

  const esc = escapeRegExp(num);
  const withSection = new RegExp(`^.*? — Rule ${esc}:\\s*`);
  let rest = raw.replace(withSection, "");
  if (rest === raw) {
    const ruleOnly = new RegExp(`^Rule ${esc}:\\s*`);
    rest = raw.replace(ruleOnly, "");
  }
  const out = rest.trim();
  return out.length > 0 ? out : raw.trim();
}

function formatRulesCitedForClient(rulesCited) {
  if (!Array.isArray(rulesCited)) return rulesCited;
  return rulesCited.map((entry) => {
    if (typeof entry !== "string") return entry;
    const sep = ": ";
    const idx = entry.indexOf(sep);
    if (idx === -1) return entry;
    const num = entry.slice(0, idx).trim();
    const body = entry.slice(idx + sep.length);
    const cleaned = stripCrRuleDisplayPrefix(num, body);
    return `${num}: ${cleaned}`;
  });
}

function parseRuleNumbersFromBlock(rawRulesBlock) {
  return Array.from(
    new Set(
      rawRulesBlock
        .split(/[\n,;]+/)
        .map((part) =>
          part
            .replace(/^rules?\s*cited\s*:\s*/i, "")
            .replace(/^[\s•\-*]+/, "")
            .trim(),
        )
        .filter(Boolean),
    ),
  );
}

async function resolveRulesCited(supabase, rawRulesBlock) {
  const parsedRuleNumbers = parseRuleNumbersFromBlock(rawRulesBlock);
  if (parsedRuleNumbers.length === 0) return [];

  const { data: exactRules, error: rulesLookupError } = await supabase
    .from("comprehensive_rules")
    .select("rule_number, rule_text")
    .in("rule_number", parsedRuleNumbers);

  if (rulesLookupError) {
    console.error("Error looking up exact rules:", rulesLookupError);
  }

  const ruleMap = Object.fromEntries(
    (exactRules ?? []).map((r) => [r.rule_number, r.rule_text]),
  );

  const rules_cited = parsedRuleNumbers.map((num) => {
    const text = ruleMap[num];
    return text ? `${num}: ${text}` : num;
  });

  const unmatched = parsedRuleNumbers.filter((num) => !ruleMap[num]);
  for (const num of unmatched) {
    const { data: fuzzyRows, error: fuzzyError } = await supabase
      .from("comprehensive_rules")
      .select("rule_number, rule_text")
      .like("rule_number", `${num}%`)
      .limit(1);

    if (fuzzyError) {
      console.error("Error looking up fuzzy rule match:", {
        rule_number: num,
        error: fuzzyError,
      });
      continue;
    }

    if (fuzzyRows?.[0]) {
      const row = fuzzyRows[0];
      const idx = rules_cited.indexOf(num);
      if (idx !== -1) {
        rules_cited[idx] = `${row.rule_number}: ${row.rule_text}`;
      }
    }
  }

  return rules_cited;
}

module.exports = {
  stripCrRuleDisplayPrefix,
  formatRulesCitedForClient,
  parseRuleNumbersFromBlock,
  resolveRulesCited,
};

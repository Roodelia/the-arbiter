const { RAG_CONFIG, EXPANSION_BLOCKLIST } = require("../config/rag");
const { RETRIEVAL_ANCHORS } = require("../data/retrieval-anchors");

function getRuleNumber(row) {
  return row?.rule_number || row?.rule || null;
}

function compareRuleNumber(a, b) {
  const aRule = String(getRuleNumber(a) || "");
  const bRule = String(getRuleNumber(b) || "");
  return aRule.localeCompare(bRule);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function applyRetrievalAnchors(situation, oracleTexts) {
  const haystack = [situation || "", ...(oracleTexts || [])]
    .join("\n")
    .toLowerCase();
  const matches = [];
  for (const anchor of RETRIEVAL_ANCHORS) {
    if (anchor.pattern.test(haystack)) {
      for (const ruleNumber of anchor.rules) {
        matches.push({ rule_number: ruleNumber, label: anchor.label });
      }
    }
  }
  return matches;
}

function mergeBaseMatches(baseMatches) {
  const mergedByRuleNumber = new Map();
  for (const m of baseMatches) {
    const ruleNumber = getRuleNumber(m);
    if (ruleNumber && !mergedByRuleNumber.has(ruleNumber)) {
      const { embedding: _dropEmbed, ...rest } = m;
      mergedByRuleNumber.set(ruleNumber, {
        ...rest,
        rule_number: ruleNumber,
        similarity: m.similarity ?? null,
        expanded: false,
      });
    }
  }
  return mergedByRuleNumber;
}

function buildAnchorLabelMap(anchorMatches) {
  const anchorLabelByRule = new Map();
  for (const match of anchorMatches) {
    if (!match?.rule_number || anchorLabelByRule.has(match.rule_number)) {
      continue;
    }
    anchorLabelByRule.set(match.rule_number, match.label);
  }
  return anchorLabelByRule;
}

async function injectAnchoredRules(
  supabase,
  mergedByRuleNumber,
  situation,
  cardOracleTexts,
) {
  const anchorMatches = applyRetrievalAnchors(situation, cardOracleTexts);
  const anchorRuleNumbers = Array.from(
    new Set(anchorMatches.map((a) => a.rule_number).filter(Boolean)),
  );
  const anchorLabelByRule = buildAnchorLabelMap(anchorMatches);

  const anchoredRulesToFetch = anchorRuleNumbers.filter(
    (ruleNumber) => !mergedByRuleNumber.has(ruleNumber),
  );
  const addedAnchoredRuleNumbers = [];

  if (anchoredRulesToFetch.length > 0) {
    const { data: anchoredRows, error: anchoredRulesError } = await supabase
      .from("comprehensive_rules")
      .select("rule_number, rule_text, parent_rule_number")
      .in("rule_number", anchoredRulesToFetch);

    if (anchoredRulesError) {
      console.error("Supabase anchored rule lookup error:", anchoredRulesError);
    } else {
      for (const row of Array.isArray(anchoredRows) ? anchoredRows : []) {
        if (!row?.rule_number || mergedByRuleNumber.has(row.rule_number)) {
          continue;
        }
        mergedByRuleNumber.set(row.rule_number, {
          ...row,
          similarity: null,
          expanded: false,
          anchored: true,
          anchor_label: anchorLabelByRule.get(row.rule_number) || null,
        });
        addedAnchoredRuleNumbers.push(row.rule_number);
      }
    }
  }

  return { anchorMatches, addedAnchoredRuleNumbers };
}

async function resolveParentRuleNumbers(supabase, hits) {
  const parentByHitRule = new Map();
  const needLookup = [];

  for (const hit of hits) {
    const hitRuleNumber = getRuleNumber(hit);
    if (!hitRuleNumber) continue;

    if (hit.parent_rule_number) {
      parentByHitRule.set(hitRuleNumber, hit.parent_rule_number);
    } else {
      needLookup.push(hitRuleNumber);
    }
  }

  if (needLookup.length > 0) {
    const { data: parentRows } = await supabase
      .from("comprehensive_rules")
      .select("rule_number, parent_rule_number")
      .in("rule_number", needLookup);

    for (const row of Array.isArray(parentRows) ? parentRows : []) {
      if (row?.rule_number) {
        parentByHitRule.set(row.rule_number, row.parent_rule_number || null);
      }
    }
    for (const hitRuleNumber of needLookup) {
      if (!parentByHitRule.has(hitRuleNumber)) {
        parentByHitRule.set(hitRuleNumber, null);
      }
    }
  }

  return parentByHitRule;
}

async function fetchRuleFamilyRows(supabase, hitRuleNumber, parentRuleNumber) {
  if (parentRuleNumber) {
    const { data } = await supabase
      .from("comprehensive_rules")
      .select("rule_number, rule_text, embedding, parent_rule_number")
      .or(
        `parent_rule_number.eq.${parentRuleNumber},rule_number.eq.${parentRuleNumber}`,
      );
    return Array.isArray(data) ? data : [];
  }

  const { data } = await supabase
    .from("comprehensive_rules")
    .select("rule_number, rule_text, embedding, parent_rule_number")
    .eq("parent_rule_number", hitRuleNumber);
  return Array.isArray(data) ? data : [];
}

function rerankFamilyRows(familyRows, queryEmbedding) {
  return familyRows
    .filter((row) => row.embedding)
    .map((row) => ({
      ...row,
      similarity: cosineSimilarity(queryEmbedding, row.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, RAG_CONFIG.expansionFamilyLimit)
    .map(({ embedding, ...rest }) => ({
      ...rest,
      expanded: true,
    }));
}

async function expandSingleHit(supabase, hit, parentRuleNumber, queryEmbedding) {
  const hitRuleNumber = getRuleNumber(hit);
  if (!hitRuleNumber) return [];

  const skipExpansion = parentRuleNumber
    ? EXPANSION_BLOCKLIST.has(parentRuleNumber)
    : EXPANSION_BLOCKLIST.has(hitRuleNumber);
  if (skipExpansion) return [];

  const familyRows = await fetchRuleFamilyRows(
    supabase,
    hitRuleNumber,
    parentRuleNumber,
  );
  return rerankFamilyRows(familyRows, queryEmbedding);
}

async function expandTopHits(supabase, baseMatches, queryEmbedding, mergedByRuleNumber) {
  const topHits = baseMatches.slice(0, RAG_CONFIG.expansionTopHits);
  const parentByHitRule = await resolveParentRuleNumbers(supabase, topHits);

  const expansionResults = await Promise.all(
    topHits.map((hit) => {
      const hitRuleNumber = getRuleNumber(hit);
      const parentRuleNumber = hitRuleNumber
        ? (parentByHitRule.get(hitRuleNumber) ?? null)
        : null;
      return expandSingleHit(supabase, hit, parentRuleNumber, queryEmbedding);
    }),
  );

  for (const cleanedRows of expansionResults) {
    for (const row of cleanedRows) {
      if (!row?.rule_number) continue;
      if (!mergedByRuleNumber.has(row.rule_number)) {
        mergedByRuleNumber.set(row.rule_number, row);
      }
    }
  }
}

function sortRulesForContext(rules) {
  return [...rules].sort((a, b) => {
    if (a.anchored && !b.anchored) return -1;
    if (!a.anchored && b.anchored) return 1;
    if (!a.expanded && !b.expanded) {
      return (b.similarity ?? 0) - (a.similarity ?? 0);
    }
    if (a.expanded && !b.expanded) return 1;
    if (!a.expanded && b.expanded) return -1;
    return compareRuleNumber(a, b);
  });
}

function capRagContext(finalRules) {
  const cap = RAG_CONFIG.contextCap;
  if (finalRules.length <= cap) return finalRules;

  const anchored = finalRules.filter((r) => r.anchored);
  const semantic = finalRules
    .filter((r) => !r.anchored && !r.expanded)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  const expanded = finalRules.filter((r) => r.expanded && !r.anchored);

  if (anchored.length >= cap) {
    console.warn(
      `[/ruling] Anchored rules exceed cap (${anchored.length} anchors > ${cap}). Keeping all anchors.`,
    );
    return [...anchored].sort(compareRuleNumber);
  }

  const kept = [...anchored, ...semantic];
  const remaining = cap - kept.length;
  if (remaining > 0) kept.push(...expanded.slice(0, remaining));

  return kept.sort(compareRuleNumber);
}

function toRagMatches(finalRulesCapped) {
  return finalRulesCapped.map((rule) => ({
    rule_number: getRuleNumber(rule) || "",
    similarity: rule.similarity ?? null,
    expanded: rule.expanded ?? false,
    anchored: rule.anchored ?? false,
    anchor_label: rule.anchor_label ?? null,
  }));
}

function formatCrChunks(finalRulesCapped) {
  return finalRulesCapped
    .map((m, idx) => {
      const ruleNumber = getRuleNumber(m) || `Rule ${idx + 1}`;
      const text = m.rule_text || m.text || "";
      return `${ruleNumber}: ${text}`;
    })
    .join("\n\n");
}

/**
 * Merges vector hits, retrieval anchors, and parent/sibling expansion into capped CR context.
 */
async function retrieveRagContext({
  supabase,
  queryEmbedding,
  situation,
  cardOracleTexts,
  baseMatches,
}) {
  const mergedByRuleNumber = mergeBaseMatches(baseMatches);

  const { anchorMatches, addedAnchoredRuleNumbers } = await injectAnchoredRules(
    supabase,
    mergedByRuleNumber,
    situation,
    cardOracleTexts,
  );

  console.log(
    "[/ruling] Retrieval anchors fired:",
    anchorMatches.map((a) => `${a.label}→${a.rule_number}`),
  );
  if (anchorMatches.length > 0) {
    console.log(
      "[/ruling] Anchored rules added (not already in baseMatches):",
      addedAnchoredRuleNumbers,
    );
  }

  await expandTopHits(supabase, baseMatches, queryEmbedding, mergedByRuleNumber);

  const finalRules = sortRulesForContext(
    Array.from(mergedByRuleNumber.values()),
  );
  const finalRulesCapped = capRagContext(finalRules);

  console.log(
    `[/ruling] Final RAG context: ${finalRulesCapped.length} rules (${finalRules.length} before cap). Anchored: ${finalRulesCapped.filter((r) => r.anchored).length}, Expanded: ${finalRulesCapped.filter((r) => r.expanded).length}.`,
  );

  return {
    finalRulesCapped,
    ragMatches: toRagMatches(finalRulesCapped),
    crChunks: formatCrChunks(finalRulesCapped),
    anchorMatches,
    addedAnchoredRuleNumbers,
    totalBeforeCap: finalRules.length,
  };
}

module.exports = {
  RAG_CONFIG,
  cosineSimilarity,
  applyRetrievalAnchors,
  mergeBaseMatches,
  sortRulesForContext,
  capRagContext,
  retrieveRagContext,
};

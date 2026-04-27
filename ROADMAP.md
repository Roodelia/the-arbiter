### `rules_cited` storage normalization

**Status:** Deferred (post-Phase 2)

**Problem:** `cases.rules_cited` and `shared_rulings.rules_cited` currently store
each citation as a joined string `"<rule_number>: <rule_text>"` in a `text[]` column.
This denormalizes rule text (which lives authoritatively in `comprehensive_rules`)
and forces every programmatic consumer to parse strings to recover the rule number.

**Proposed change:** Store only rule numbers in `rules_cited` (e.g. `['611.2a', '613.1d']`),
matching the shape of `golden_test_cases.required_rules`. Assemble display strings at
response time by joining against `comprehensive_rules.rule_text`.

**Migration steps:**
1. Update `/ruling` handler to write rule numbers only (drop the `: <text>` suffix).
2. Update response assembly to fetch rule text from `comprehensive_rules` and 
   build the display string fresh.
3. Delete `formatRulesCitedForClient` — no longer needed.
4. Apply same change to `/share` handler and `shared_rulings` table.
5. Backfill existing rows:
```sql
   UPDATE cases SET rules_cited = ARRAY(
     SELECT split_part(unnested, ': ', 1) FROM unnest(rules_cited) AS unnested
   ) WHERE rules_cited IS NOT NULL;
```
   Run on dev first; same query for `shared_rulings`.

**Why deferred:** Architectural cleanup, not a quality fix. Lower priority than 
active ruling-quality work in Phase 2 (RAG anchors, golden eval baseline, 
reasoning-layer diagnostics). Pick up between major Phase 2 iterations or 
when starting Phase 3.

**Benefits when shipped:**
- Eval matching becomes trivial array operation (`@>` containment).
- No data duplication; rule text lives in one place.
- Rule errata or formatting fixes don't require row migration.
- Removes string-parsing logic from the codebase.
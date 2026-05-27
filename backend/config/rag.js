/** Tunable RAG retrieval parameters for /ruling */
const RAG_CONFIG = {
  /** Vector search via Supabase match_rules */
  matchCount: 8,
  /** Top semantic hits whose rule families are expanded */
  expansionTopHits: 2,
  /** Max related rules kept per expanded family (after cosine rerank) */
  expansionFamilyLimit: 5,
  /** Max rules sent to Claude after merge (anchored > semantic > expanded) */
  contextCap: 12,
  /** Voyage model for query embeddings at ruling time */
  voyageModel: "voyage-3.5",
};

/** Parent/base rule numbers where sibling expansion is skipped (broad chapters) */
const EXPANSION_BLOCKLIST = new Set([
  "104.3",
  "111.10",
  "112.1",
  "113.6",
  "607.2",
  "702",
  "703.4",
  "704.5",
  "800.4",
  "807.4",
]);

module.exports = { RAG_CONFIG, EXPANSION_BLOCKLIST };

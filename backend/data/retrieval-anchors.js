/** Pattern-based CR rule injection for /ruling RAG (situation + oracle text) */
const RETRIEVAL_ANCHORS = [
  {
    label: "ability_loss",
    pattern: /\blos(e|es) (all (other )?)?abilities|no abilities|without abilities/i,
    rules: ["613.1", "613.1f", "613.6"],
  },
  {
    label: "type_change",
    pattern:
      /becomes? a .{1,40} creature|is a .{1,40} creature in addition|are .{1,40} creatures? in addition/i,
    rules: ["613.1", "613.1d"],
  },
  {
    label: "additional_trigger",
    pattern:
      /triggers an additional time|triggers one additional time|that ability triggers/i,
    rules: ["603.2d"],
  },
  {
    label: "quantity_replacement",
    pattern: /create twice that many|double that number|twice as many|puts twice that many/i,
    rules: ["614.1", "614.6", "111.10"],
  },
];

module.exports = { RETRIEVAL_ANCHORS };

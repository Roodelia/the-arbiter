const SCRYFALL_HEADERS = {
  "User-Agent": "ManaJudge/1.0 (https://manajudge.com)",
  Accept: "application/json",
};

async function fetchCardOracle(cardName) {
  const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(
    cardName,
  )}`;

  try {
    const res = await fetch(url, { headers: SCRYFALL_HEADERS });
    if (!res.ok) {
      throw new Error(`Scryfall error for "${cardName}": ${res.statusText}`);
    }
    const data = await res.json();

    let officialRulings = [];
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const cardId = data?.id;
      if (cardId) {
        const rulingsRes = await fetch(
          `https://api.scryfall.com/cards/${cardId}/rulings`,
          { headers: SCRYFALL_HEADERS },
        );
        if (rulingsRes.ok) {
          const rulings_data = await rulingsRes.json();
          officialRulings = Array.isArray(rulings_data?.data)
            ? rulings_data.data
                .filter((r) => r?.source === "wotc")
                .map((r) => r?.comment)
                .filter((comment) => typeof comment === "string")
            : [];
        }
      }
    } catch {
      officialRulings = [];
    }

    return {
      name: data.name,
      mana_cost: data.mana_cost || "",
      oracle_text: data.oracle_text || "",
      type_line: data.type_line || "",
      power: data.power || null,
      toughness: data.toughness || null,
      loyalty: data.loyalty || null,
      card_faces: Array.isArray(data.card_faces)
        ? data.card_faces.map((face) => ({
            name: face?.name || "",
            mana_cost: face?.mana_cost || "",
            type_line: face?.type_line || "",
            oracle_text: face?.oracle_text || "",
            power: face?.power || null,
            toughness: face?.toughness || null,
            loyalty: face?.loyalty || null,
          }))
        : [],
      image_uri:
        data.image_uris?.normal ||
        data.image_uris?.large ||
        data.card_faces?.[0]?.image_uris?.normal ||
        null,
      rulings: officialRulings,
    };
  } catch (err) {
    console.error("Error fetching Scryfall oracle:", { cardName, error: err });
    throw err;
  }
}

/**
 * Builds a human-readable card summary block for non-canonical contexts only:
 * category generation prompt input and /ruling oracle_referenced fallback text.
 */
function buildCardSummaryBlock(oracleData, { includeStats = false } = {}) {
  return oracleData
    .map((c) => {
      const stats =
        includeStats && c.power != null && c.toughness != null
          ? ` (${c.power}/${c.toughness})`
          : "";
      const rulingsBlock =
        c.rulings && c.rulings.length > 0
          ? "\nOfficial Rulings:\n" + c.rulings.map((r) => `• ${r}`).join("\n")
          : "";
      return `${c.name}${stats}\n${c.type_line}\n${c.oracle_text}${rulingsBlock}`;
    })
    .join("\n\n");
}

function buildCardDataBlock(oracleData) {
  const cardsText = oracleData
    .map((c) => {
      const lines = [];
      lines.push(`Card: ${c.name}`);

      const hasFaces = Array.isArray(c.card_faces) && c.card_faces.length > 0;
      if (hasFaces) {
        c.card_faces.forEach((face, idx) => {
          const label =
            idx === 0
              ? "Front Face"
              : idx === 1
                ? "Back Face"
                : `Face ${idx + 1}`;
          lines.push(`${label}: ${face.name || ""}`.trim());
          if (face.mana_cost) lines.push(`Mana Cost: ${face.mana_cost}`);
          if (face.type_line) lines.push(`Type: ${face.type_line}`);
          if (face.oracle_text) lines.push(`Oracle Text: ${face.oracle_text}`);
          if (face.power != null && face.toughness != null) {
            lines.push(`Power/Toughness: ${face.power}/${face.toughness}`);
          }
          if (face.loyalty != null) {
            lines.push(`Loyalty: ${face.loyalty}`);
          }
        });
      } else {
        if (c.mana_cost) lines.push(`Mana Cost: ${c.mana_cost}`);
        if (c.type_line) lines.push(`Type: ${c.type_line}`);
        if (c.oracle_text) lines.push(`Oracle Text: ${c.oracle_text}`);
        if (c.power != null && c.toughness != null) {
          lines.push(`Power/Toughness: ${c.power}/${c.toughness}`);
        }
        if (c.loyalty != null) {
          lines.push(`Loyalty: ${c.loyalty}`);
        }
      }

      return lines.join("\n");
    })
    .join("\n\n");

  return `=== CARD DATA (authoritative — use these values exactly) ===

${cardsText}

=== END CARD DATA ===`;
}

function buildOfficialRulingsBlock(oracleData) {
  return oracleData
    .map((c) => {
      const lines = [`Card: ${c.name}`];
      if (Array.isArray(c.rulings) && c.rulings.length > 0) {
        lines.push("Official Rulings:");
        lines.push(...c.rulings.map((r) => `• ${r}`));
      } else {
        lines.push("Official Rulings: (none)");
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

async function fetchAllCardOracle(cards) {
  return Promise.all(cards.map((cardName) => fetchCardOracle(cardName)));
}

function extractCardOracleTexts(oracleData) {
  return oracleData
    .map((c) => {
      const oracle =
        typeof c.oracle_text === "string" ? c.oracle_text.trim() : "";
      if (oracle) return oracle;
      return typeof c.name === "string" ? c.name.trim() : "";
    })
    .filter(Boolean);
}

module.exports = {
  fetchCardOracle,
  fetchAllCardOracle,
  buildCardSummaryBlock,
  buildCardDataBlock,
  buildOfficialRulingsBlock,
  extractCardOracleTexts,
};

export async function fetchCardImageUri(cardName: string): Promise<string | null> {
  try {
    const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(
      cardName
    )}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return (
      data.image_uris?.normal ||
      data.image_uris?.large ||
      data.card_faces?.[0]?.image_uris?.normal ||
      null
    );
  } catch {
    return null;
  }
}

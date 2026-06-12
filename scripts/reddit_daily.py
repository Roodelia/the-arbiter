"""
reddit_daily.py — ManaJudge daily Reddit runner.
Fetches top r/mtgrules posts, tests 2 against ManaJudge, logs to Supabase via /log.
"""

import json
import re
import sys
import time
import uuid
from urllib.request import urlopen, Request
from urllib.error import URLError
import urllib.parse

BACKEND = "https://manajudge-production.up.railway.app"
REDDIT_URL = "https://www.reddit.com/r/mtgrules/top.json?t=day&limit=10"
SCRYFALL_AC = "https://api.scryfall.com/cards/autocomplete?q={}"
MAX_POSTS = 2


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def get(url, headers=None):
    req = Request(url, headers=headers or {"User-Agent": "ManaJudgeBot/1.0"})
    with urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def post(url, body):
    data = json.dumps(body).encode()
    req = Request(url, data=data, headers={
        "Content-Type": "application/json",
        "User-Agent": "ManaJudgeBot/1.0",
    })
    with urlopen(req, timeout=30) as r:
        return json.loads(r.read())


# ---------------------------------------------------------------------------
# Card extraction
# ---------------------------------------------------------------------------

def scryfall_autocomplete(query):
    """Return Scryfall autocomplete results for a query string."""
    try:
        time.sleep(0.1)  # respect Scryfall rate limit
        url = SCRYFALL_AC.format(urllib.parse.quote(query))
        data = get(url)
        return data.get("data", [])
    except Exception:
        return []


def extract_cards(text, max_candidates=8):
    """
    Extract likely MTG card names from post text.
    Strategy: find Title Case phrases (1-4 words), validate against Scryfall autocomplete.
    Returns a list of confirmed card names (up to 4).
    """
    # Pull Title Case phrases (1-4 words, each word capitalised)
    pattern = r"\b([A-Z][a-z']+(?:\s+[A-Z][a-z']+){0,3})\b"
    candidates = list(dict.fromkeys(re.findall(pattern, text)))  # dedupe, preserve order

    # Also grab anything in quotes
    quoted = re.findall(r'["“”]([^""“”]{3,40})["“”]', text)
    candidates = quoted + [c for c in candidates if c not in quoted]

    confirmed = []
    seen = set()
    for phrase in candidates[:max_candidates]:
        phrase = phrase.strip()
        if phrase in seen or len(phrase) < 3:
            continue
        seen.add(phrase)
        results = scryfall_autocomplete(phrase)
        # Accept if the phrase matches the start of any autocomplete result
        phrase_lower = phrase.lower()
        for name in results:
            if name.lower().startswith(phrase_lower) or phrase_lower in name.lower():
                confirmed.append(name)
                break
        if len(confirmed) >= 4:
            break

    return confirmed


def is_rules_question(title, body):
    """Heuristic: does the post look like a rules question?"""
    text = (title + " " + body).lower()
    question_signals = ["?", "how does", "can i", "does ", "when ", "what happens",
                        "trigger", "ability", "stack", "priority", "resolve",
                        "combat", "counter", "target", "cast", "controller"]
    skip_signals = ["[image]", "looking for", "lf ", "wtb", "wts", "irl", "sale"]
    if any(s in text for s in skip_signals):
        return False
    return any(s in text for s in question_signals)


# ---------------------------------------------------------------------------
# ManaJudge API calls
# ---------------------------------------------------------------------------

def get_categories(cards):
    return post(f"{BACKEND}/categories", {"cards": cards})


def get_ruling(cards, situation, category):
    return post(f"{BACKEND}/ruling", {
        "cards": cards,
        "situation": situation,
        "category": category,
    })


def log_case(cards, situation, category, ruling_data, case_id, session_id):
    return post(f"{BACKEND}/log", {
        "session_id": session_id,
        "case_id": case_id,
        "cards": cards,
        "situation": situation,
        "selected_category": category,
        "ruling": ruling_data.get("ruling", ""),
        "explanation": ruling_data.get("explanation", ""),
        "rules_cited": ruling_data.get("rules_cited", []),
        "cr_version": ruling_data.get("cr_version", ""),
        "rag_matches": ruling_data.get("rag_matches", []),
        "source": "agent",
    })


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    session_id = str(uuid.uuid4())
    results = []
    skipped = []

    print("Fetching r/mtgrules top posts...")
    try:
        data = get(REDDIT_URL)
    except URLError as e:
        print(f"ERROR: Could not fetch Reddit — {e}", file=sys.stderr)
        sys.exit(1)

    posts = data["data"]["children"]
    print(f"Fetched {len(posts)} posts.")

    processed = 0
    for item in posts:
        if processed >= MAX_POSTS:
            break

        p = item["data"]
        title = p.get("title", "")
        body = p.get("selftext", "")
        url = p.get("url", "")
        score = p.get("score", 0)
        text = f"{title}\n{body}"

        print(f"\nEvaluating: {title[:80]}")

        # Skip non-question posts
        if not is_rules_question(title, body):
            reason = "no rules question signals"
            print(f"  Skipping — {reason}")
            skipped.append({"title": title, "url": url, "reason": reason})
            continue

        # Extract card names
        cards = extract_cards(text)
        if not cards:
            reason = "no identifiable card names"
            print(f"  Skipping — {reason}")
            skipped.append({"title": title, "url": url, "reason": reason})
            continue

        print(f"  Cards identified: {cards}")

        # Build situation from title + body (truncated)
        situation = title
        if body and body != "[removed]":
            situation = f"{title}\n\n{body[:500]}"

        # Call ManaJudge
        try:
            print("  Getting categories...")
            cat_resp = get_categories(cards)
            categories = cat_resp.get("categories", [])
            category = categories[0] if categories else ""
            print(f"  Category: {category}")

            print("  Getting ruling...")
            ruling_resp = get_ruling(cards, situation, category)
            ruling_text = ruling_resp.get("ruling", "")
            print(f"  Ruling: {ruling_text[:100]}")

            case_id = str(uuid.uuid4())
            print("  Logging to Supabase...")
            log_case(cards, situation, category, ruling_resp, case_id, session_id)
            print(f"  Logged. case_id={case_id}")

            results.append({
                "title": title,
                "url": url,
                "score": score,
                "cards": cards,
                "situation": situation,
                "category": category,
                "ruling": ruling_text,
                "case_id": case_id,
            })
            processed += 1

        except Exception as e:
            print(f"  ERROR calling ManaJudge: {e}", file=sys.stderr)
            skipped.append({"title": title, "url": url, "reason": f"ManaJudge error: {e}"})

    # ---------------------------------------------------------------------------
    # Output summary
    # ---------------------------------------------------------------------------
    print("\n" + "="*60)
    print(f"Run complete. Processed: {len(results)}, Skipped: {len(skipped)}")
    for r in results:
        print(f"\n[POST] {r['title']}")
        print(f"  Cards: {', '.join(r['cards'])}")
        print(f"  Ruling: {r['ruling']}")
        print(f"  case_id: {r['case_id']}")
    for s in skipped:
        print(f"\n[SKIP] {s['title']} — {s['reason']}")


if __name__ == "__main__":
    main()

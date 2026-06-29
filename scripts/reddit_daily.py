"""
reddit_daily.py -- ManaJudge daily Reddit runner.
Fetches top r/mtgrules posts, tests 2 against ManaJudge, logs to Supabase via /log,
and writes a markdown summary to the Obsidian vault.

Usage:
    # Automatic (RSS fetch):
    python scripts/reddit_daily.py

    # Manual (paste cards + situation from a live session):
    python scripts/reddit_daily.py --manual --cards "Card One" "Card Two" --situation "What happens when..."
    python scripts/reddit_daily.py --manual --cards "Card One" "Card Two" --situation "..." --title "Post title"

Schedule automatic mode with Windows Task Scheduler to run daily.
"""

import argparse
import html
import json
import re
import sys
import time
import uuid
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError
import urllib.parse

BACKEND = "https://the-arbiter-production.up.railway.app"
REDDIT_RSS = "https://www.reddit.com/r/mtgrules/top.rss?t=day&limit=10"
SCRYFALL_AC = "https://api.scryfall.com/cards/autocomplete?q={}"
MAX_POSTS = 2

OBSIDIAN_LOG_DIR = Path(
    r"C:\Users\WeiHa\00_Cortana\Workstations\ManaJudge\ManaJudge Resources\Reddit Logs"
)


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

REDDIT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; ManaJudgeBot/1.0; +https://manajudge.com)",
    "Accept": "application/rss+xml, application/xml, text/xml",
}


def get_rss(url):
    """Fetch a Reddit RSS feed (Atom format) and return a list of {title, url, body} dicts."""
    req = Request(url, headers=REDDIT_HEADERS)
    with urlopen(req, timeout=20) as r:
        raw = r.read()

    root = ET.fromstring(raw)
    atom_ns = "http://www.w3.org/2005/Atom"
    ns = {
        "atom": atom_ns,
        "content": "http://purl.org/rss/1.0/modules/content/",
    }

    entries = root.findall("atom:entry", ns) or root.findall(".//item")

    items = []
    for entry in entries:
        title_el = entry.find("atom:title", ns) or entry.find("title")
        title = (title_el.text or "").strip() if title_el is not None else ""

        link_el = entry.find("atom:link", ns) or entry.find("link")
        if link_el is not None:
            link = link_el.get("href") or (link_el.text or "").strip()
        else:
            link = ""

        body_el = (
            entry.find("atom:content", ns)
            or entry.find("content:encoded", ns)
            or entry.find("atom:summary", ns)
            or entry.find("description")
        )
        body_html = (body_el.text or "") if body_el is not None else ""
        body = html.unescape(re.sub(r"<[^>]+>", " ", body_html)).strip()
        body = re.sub(r"\s{2,}", " ", body)

        items.append({"title": title, "url": link, "body": body})
    return items


def get(url, headers=None):
    req = Request(url, headers=headers or {"User-Agent": "ManaJudgeBot/1.0"})
    with urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def post_json(url, body):
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
    1. Prefer explicit [[wikilinks]] -- most reliable on r/mtgrules.
    2. Fall back to quoted strings, then Title Case phrases.
    3. Validate all candidates against Scryfall autocomplete.
    Returns a list of confirmed card names (up to 4).
    """
    wikilinks = re.findall(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]", text)
    if wikilinks:
        candidates = [w.strip() for w in wikilinks[:max_candidates]]
    else:
        pattern = r"\b([A-Z][a-z']+(?:\s+[A-Z][a-z']+){0,3})\b"
        candidates = list(dict.fromkeys(re.findall(pattern, text)))
        quoted = re.findall(r'"([^"]{3,40})"', text)
        candidates = quoted + [c for c in candidates if c not in quoted]

    confirmed = []
    seen = set()
    for phrase in candidates[:max_candidates]:
        phrase = phrase.strip()
        if phrase in seen or len(phrase) < 3:
            continue
        seen.add(phrase)
        results = scryfall_autocomplete(phrase)
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
    return post_json(f"{BACKEND}/categories", {"cards": cards})


def get_ruling(cards, situation, category):
    return post_json(f"{BACKEND}/ruling", {
        "cards": cards,
        "situation": situation,
        "category": category,
    })


def log_case(cards, situation, category, ruling_data, case_id, session_id):
    return post_json(f"{BACKEND}/log", {
        "session_id": session_id,
        "case_id": case_id,
        "cards": cards,
        "situation": situation,
        "selected_category": category,
        "ruling": ruling_data.get("ruling", ""),
        "explanation": ruling_data.get("explanation", ""),
        "rules_cited": ruling_data.get("rules_cited", []),
        "source": "agent",
    })


# ---------------------------------------------------------------------------
# Core: process one post through ManaJudge
# ---------------------------------------------------------------------------

def process_post(session_id, title, situation, cards, url=""):
    """Run categories -> ruling -> log for a single post. Returns result dict."""
    print(f"\n  Cards: {cards}")

    print("  Getting categories...")
    try:
        cat_resp = get_categories(cards)
        categories = cat_resp.get("categories", [])
        category = categories[0] if categories else ""
        print(f"  Category: {category}")
    except Exception as e:
        print(f"  Categories failed ({e}), continuing without")
        category = ""

    print("  Getting ruling...")
    ruling_resp = get_ruling(cards, situation, category)
    ruling_text = ruling_resp.get("ruling", "")
    print(f"  Ruling: {ruling_text[:120]}")

    case_id = ruling_resp.get("case_id") or str(uuid.uuid4())

    print("  Logging to Supabase...")
    log_case(cards, situation, category, ruling_resp, case_id, session_id)
    print(f"  Logged. case_id={case_id}")

    return {
        "title": title,
        "url": url,
        "cards": cards,
        "situation": situation,
        "category": category,
        "ruling": ruling_text,
        "case_id": case_id,
    }


# ---------------------------------------------------------------------------
# Obsidian log
# ---------------------------------------------------------------------------

def write_obsidian_log(today, results, skipped):
    """Write the daily markdown log to the Obsidian vault."""
    OBSIDIAN_LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = OBSIDIAN_LOG_DIR / f"{today.isoformat()}.md"

    lines = [f"# r/mtgrules Daily Log -- {today.isoformat()}\n"]

    if results:
        lines.append("## Posts Processed\n")
        for i, r in enumerate(results, 1):
            situation_preview = r["situation"][:300]
            if len(r["situation"]) > 300:
                situation_preview += "..."
            title_link = f"[{r['title']}]({r['url']})" if r.get("url") else r["title"]
            lines += [
                f"### {i}. {title_link}",
                f"**Cards:** {', '.join(r['cards'])}",
                f"**Situation:** {situation_preview}",
                f"**Category:** {r.get('category') or 'none'}",
                f"**Ruling:** {r.get('ruling') or 'none'}",
                f"**Supabase case_id:** `{r.get('case_id', 'none')}`",
                "\n---\n",
            ]
    else:
        lines.append("## Posts Processed\n\nNone.\n")

    if skipped:
        lines.append("## Skipped Posts\n")
        for s in skipped:
            lines.append(f"- [{s['title']}]({s['url']}) -- {s['reason']}")

    log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nLog written: {log_path}")
    return log_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="ManaJudge daily Reddit runner")
    parser.add_argument("--manual", action="store_true",
                        help="Skip RSS fetch; provide cards and situation directly")
    parser.add_argument("--cards", nargs="+", metavar="CARD",
                        help="Card names (use with --manual)")
    parser.add_argument("--situation", type=str, default="",
                        help="Situation description (use with --manual)")
    parser.add_argument("--title", type=str, default="Manual entry",
                        help="Post title for the Obsidian log (optional, use with --manual)")
    args = parser.parse_args()

    session_id = str(uuid.uuid4())
    results = []
    skipped = []

    if args.manual:
        if not args.cards:
            print("ERROR: --manual requires --cards", file=sys.stderr)
            sys.exit(1)
        situation = args.situation or args.title
        print(f"Manual mode: {args.cards}")
        try:
            result = process_post(session_id, args.title, situation, args.cards)
            results.append(result)
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)
            sys.exit(1)

    else:
        print("Fetching r/mtgrules top posts (RSS)...")
        try:
            posts = get_rss(REDDIT_RSS)
        except URLError as e:
            print(f"ERROR: Could not fetch Reddit RSS -- {e}", file=sys.stderr)
            sys.exit(1)

        print(f"Fetched {len(posts)} posts.")

        processed = 0
        for p in posts:
            if processed >= MAX_POSTS:
                break

            title = p["title"]
            body = p["body"]
            url = p["url"]
            text = f"{title}\n{body}"

            print(f"\nEvaluating: {title[:80]}")

            if not is_rules_question(title, body):
                reason = "no rules question signals"
                print(f"  Skipping -- {reason}")
                skipped.append({"title": title, "url": url, "reason": reason})
                continue

            cards = extract_cards(text)
            if not cards:
                reason = "no identifiable card names"
                print(f"  Skipping -- {reason}")
                skipped.append({"title": title, "url": url, "reason": reason})
                continue

            situation = title
            if body and body != "[removed]":
                situation = f"{title}\n\n{body[:500]}"

            try:
                result = process_post(session_id, title, situation, cards, url)
                results.append(result)
                processed += 1
            except Exception as e:
                print(f"  ERROR calling ManaJudge: {e}", file=sys.stderr)
                skipped.append({"title": title, "url": url, "reason": f"ManaJudge error: {e}"})

    print("\n" + "=" * 60)
    print(f"Run complete. Processed: {len(results)}, Skipped: {len(skipped)}")
    for r in results:
        print(f"\n[POST] {r['title']}")
        print(f"  Cards: {', '.join(r['cards'])}")
        print(f"  Ruling: {r['ruling']}")
        print(f"  case_id: {r['case_id']}")

    write_obsidian_log(date.today(), results, skipped)


if __name__ == "__main__":
    main()

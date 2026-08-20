"""
ManaJudge — Comprehensive Rules Auto-Updater
==============================================
Checks Wizards' official rules page (magic.wizards.com/en/rules) for a
newer Magic: The Gathering Comprehensive Rules release than the one
currently wired into scripts/embed_rules.py. If a newer one exists:

  1. Rewrites the CR_URL constant in scripts/embed_rules.py to point at
     the new file — this is the "date in the code" the app reads its
     rules version from.
  2. Deletes the stale cached scripts/comprehensive_rules.txt so
     embed_rules.py is forced to download the new text instead of
     silently re-embedding the old cached copy under the new version
     label (this happened before: the cached file said "effective as
     of February 27, 2026" while CR_URL pointed at the April 17 file —
     always delete the cache before re-running, never trust it).
  3. Runs embed_rules.py's existing pipeline end-to-end: download ->
     chunk by rule number -> embed via Voyage AI -> clear + upload to
     the Supabase `comprehensive_rules` table -> run a sanity query.

This script does NOT touch the Railway `CR_VERSION` environment
variable (that's deploy config, not code) and does NOT commit or push
to git — both are left as explicit manual steps, printed at the end.

Requires network access to magic.wizards.com / media.wizards.com, and
the same environment variables as embed_rules.py: VOYAGE_API_KEY,
SUPABASE_URL, SUPABASE_SERVICE_KEY (loaded via scripts/.env).

Usage:
    py scripts/update_comprehensive_rules.py             # check + update if needed
    py scripts/update_comprehensive_rules.py --dry-run   # check only, change nothing
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

import requests

SCRIPT_DIR = Path(__file__).resolve().parent
EMBED_SCRIPT = SCRIPT_DIR / "embed_rules.py"
CACHED_CR_FILE = SCRIPT_DIR / "comprehensive_rules.txt"
RULES_PAGE = "https://magic.wizards.com/en/rules"
USER_AGENT = "Mozilla/5.0 (compatible; ManaJudgeRulesUpdater/1.0)"

CR_URL_LINE_RE = re.compile(r'^(CR_URL\s*=\s*)"([^"]+)"', re.MULTILINE)
# Matches both .txt and .pdf listings on the rules page; date sits right
# after the literal "%20" (URL-encoded space), so capturing 8 digits from
# that anchor is unambiguous even though "%20" itself ends in digits.
CR_FILE_RE = re.compile(r"MagicCompRules%20(\d{8})\.(txt|pdf)", re.IGNORECASE)


def get_current_cr_url() -> str:
    if not EMBED_SCRIPT.exists():
        raise RuntimeError(f"Expected to find {EMBED_SCRIPT} — run this from the ManaJudge repo.")
    text = EMBED_SCRIPT.read_text(encoding="utf-8")
    m = CR_URL_LINE_RE.search(text)
    if not m:
        raise RuntimeError(f"Could not find a CR_URL = \"...\" line in {EMBED_SCRIPT}")
    return m.group(2)


def extract_date(url: str) -> str:
    m = re.search(r"(\d{8})(?=\.txt)", url)
    if not m:
        raise ValueError(f"Could not extract an 8-digit date from {url}")
    raw = m.group(1)
    return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"


def discover_latest_cr_url() -> str:
    """Scrape the official rules page for the newest MagicCompRules date, then
    confirm a .txt actually exists at that date before returning it."""
    resp = requests.get(RULES_PAGE, timeout=30, headers={"User-Agent": USER_AGENT})
    resp.raise_for_status()

    matches = CR_FILE_RE.findall(resp.text)
    if not matches:
        raise RuntimeError(
            f"Could not find any MagicCompRules link on {RULES_PAGE}. "
            "Wizards may have changed the page layout — check it manually "
            "and update CR_URL in embed_rules.py by hand if so."
        )

    date_str, _ext = max(matches, key=lambda pair: pair[0])
    year = date_str[:4]
    txt_url = f"https://media.wizards.com/{year}/downloads/MagicCompRules%20{date_str}.txt"

    head = requests.head(txt_url, timeout=15, headers={"User-Agent": USER_AGENT})
    if head.status_code != 200:
        raise RuntimeError(
            f"Found a rules update dated {date_str} but no .txt file at {txt_url} "
            f"(status {head.status_code}). Wizards sometimes publish the PDF a "
            "few days before the plain-text version — try again shortly, or "
            "update CR_URL manually once the .txt is live."
        )
    return txt_url


def update_cr_url_in_code(new_url: str) -> None:
    text = EMBED_SCRIPT.read_text(encoding="utf-8")
    new_text, n = CR_URL_LINE_RE.subn(lambda m: f'{m.group(1)}"{new_url}"', text)
    if n != 1:
        raise RuntimeError(
            f"Expected exactly one CR_URL line in {EMBED_SCRIPT}, found {n} — "
            "aborting without writing to avoid corrupting the file."
        )
    EMBED_SCRIPT.write_text(new_text, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Check for a newer Comprehensive Rules release without changing any files or the vector DB.",
    )
    args = parser.parse_args()

    current_url = get_current_cr_url()
    current_date = extract_date(current_url)
    print(f"Currently indexed CR version: {current_date}\n  {current_url}")

    print(f"\nChecking {RULES_PAGE} for a newer release...")
    latest_url = discover_latest_cr_url()
    latest_date = extract_date(latest_url)
    print(f"Latest available CR version:  {latest_date}\n  {latest_url}")

    if latest_date <= current_date:
        print("\nAlready up to date — nothing to do.")
        return 0

    print(f"\nNewer rules found: {current_date} -> {latest_date}")

    if args.dry_run:
        print("(--dry-run) Not changing any files or the vector DB.")
        return 0

    print(f"\nUpdating CR_URL in {EMBED_SCRIPT.name} ({current_date} -> {latest_date})...")
    update_cr_url_in_code(latest_url)

    if CACHED_CR_FILE.exists():
        print(f"Deleting stale cached {CACHED_CR_FILE.name} so the new rules get downloaded fresh...")
        CACHED_CR_FILE.unlink()

    print("\nRunning embed_rules.py (download -> chunk -> embed -> upload to Supabase)...\n")
    result = subprocess.run([sys.executable, str(EMBED_SCRIPT)], cwd=SCRIPT_DIR)

    if result.returncode != 0:
        print(
            f"\nembed_rules.py exited with an error (code {result.returncode}). "
            f"CR_URL in {EMBED_SCRIPT.name} was already updated to {latest_date}, but the "
            "Supabase vector DB was NOT re-indexed — the code and the DB are now out of "
            "sync. Fix the error above, then re-run `py embed_rules.py` directly from "
            "the scripts/ folder (do not re-run this updater, or it will report "
            "'already up to date' and skip the re-embed)."
        )
        return result.returncode

    print(f"\nDone — the vector DB now reflects CR {latest_date}.")
    print("\nRemaining manual steps (not automated by this script):")
    print(f"  1. Update the CR_VERSION environment variable on Railway to {latest_date}")
    print("     (backend/config/app.js reads it at request time; it's deploy config, not code).")
    print(f"  2. Review the diff on scripts/{EMBED_SCRIPT.name}, commit, and push to GitHub.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

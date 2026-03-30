"""
MTG AI Judge — Comprehensive Rules Embedder
============================================
Downloads the MTG Comprehensive Rules, chunks by rule number,
embeds each chunk using Voyage AI, and uploads to Supabase pgvector.

Run this ONCE to set up the vector DB, then re-run whenever
Wizards releases a rules update (typically with each new set).

Prerequisites:
    py -m pip install supabase voyageai python-dotenv requests

Usage:
    py embed_rules.py

Expected runtime: 2-5 minutes
Expected cost: < $0.01 (Voyage AI embedding)

Voyage AI: https://voyageai.com — sign up for a free API key.
Recommended by Anthropic as the embedding partner for Claude-based apps.
"""

import os
import re
import time
from typing import Optional, Tuple

import requests
from dotenv import load_dotenv
import voyageai
from supabase import create_client

load_dotenv()

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────

VOYAGE_API_KEY    = os.environ.get("VOYAGE_API_KEY")
SUPABASE_URL      = os.environ.get("SUPABASE_URL")
SUPABASE_KEY      = os.environ.get("SUPABASE_SERVICE_KEY")
EMBEDDING_MODEL   = "voyage-3.5"  # 1024 dimensions, Anthropic-recommended
BATCH_SIZE        = 128            # Voyage supports up to 128 inputs per batch
CR_LOCAL_FILE     = "comprehensive_rules.txt"  # cached local copy

# The official Wizards CR plain text URL
# Note: Wizards updates this file with each set release.
# If this URL breaks, check https://magic.wizards.com/en/rules for the latest link.
CR_URL = "https://media.wizards.com/2026/downloads/MagicCompRules%2020260227.txt"

def _extract_cr_version(url: str) -> str:
    """Extract YYYYMMDD from CR URL filename and return YYYY-MM-DD."""
    match = re.search(r"(\d{8})(?=\.txt(?:$|\?))", url)
    if not match:
        match = re.search(r"(\d{8})", url)
    if not match:
        raise ValueError(f"Could not extract CR date from CR_URL: {url}")
    raw = match.group(1)
    return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"

CR_VERSION = _extract_cr_version(CR_URL)


# ─────────────────────────────────────────────
# STEP 1 — DOWNLOAD THE COMPREHENSIVE RULES
# ─────────────────────────────────────────────

def download_cr(url: str, local_path: str) -> str:
    """Download CR text file, cache locally to avoid re-downloading."""
    if os.path.exists(local_path):
        print(f"Using cached CR file: {local_path}")
        with open(local_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()

    print(f"Downloading Comprehensive Rules from Wizards...")
    response = requests.get(url, timeout=30)
    response.raise_for_status()

    # Wizards publishes the file in UTF-8 or latin-1 depending on version
    text = response.content.decode("utf-8", errors="replace")

    with open(local_path, "w", encoding="utf-8") as f:
        f.write(text)

    print(f"Downloaded and cached to {local_path} ({len(text):,} characters)")
    return text


# ─────────────────────────────────────────────
# STEP 2 — CHUNK BY RULE NUMBER
# ─────────────────────────────────────────────

# Subrule with letter suffix, e.g. 100.1a, 704.5k, 115.10a (space after letter)
RULE_LETTER_SUFFIX_RE = re.compile(r"^(\d+)\.(\d+)([a-z])\s+(.+)$")
# Subrule with trailing dot after digits, e.g. 100.1., 116.2., 115.10.
RULE_NUMBER_DOT_RE = re.compile(r"^(\d+)\.(\d+)\.\s*(.+)$")
# Major section header only (three+ digit chapter numbers), e.g. 100. General, 702. Keyword Abilities
SECTION_HEADER_RE = re.compile(r"^(\d{3,})\.\s+(.+)$")


def _parse_rule_line(line: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    If line starts a CR rule or section header, return (kind, rule_number, rest).
    kind is 'rule' or 'section'; rule_number for rules is e.g. 100.1 or 116.2a; for section, None.
    rest is text after the number for rules, or None for section (title parsed separately).
    """
    m = RULE_LETTER_SUFFIX_RE.match(line)
    if m:
        major, mid, letter, rest = m.groups()
        return "rule", f"{major}.{mid}{letter}", rest
    m = RULE_NUMBER_DOT_RE.match(line)
    if m:
        major, mid, rest = m.groups()
        return "rule", f"{major}.{mid}", rest
    m = SECTION_HEADER_RE.match(line)
    if m:
        return "section", None, None
    return None, None, None


def chunk_rules(cr_text: str) -> list[dict]:
    """
    Split CR text into chunks keyed by rule number.
    Each numbered subrule (e.g. 702.2a, 100.1, 115.10) becomes one chunk.

    Major section lines (e.g. 116. Special Actions, 702. Keyword Abilities) with no
    substantive body (combined text under 80 characters) do not become chunks; the
    title is stored and prepended to child rules, e.g.
    "Special Actions — Rule 116.2a: Playing a land is..."
    rule_number on chunks stays the child id (116.2a) for citations.
    """
    chunks: list = []
    lines = cr_text.split("\n")
    current_rule_number: Optional[str] = None
    current_rule_lines: list[str] = []
    current_section_title: str | None = None
    pending_section_lines: list[str] = []

    def flush_chunk() -> None:
        nonlocal current_rule_number, current_rule_lines
        if not current_rule_number or not current_rule_lines:
            return
        rule_text = " ".join(current_rule_lines).strip()
        if len(rule_text) <= 10:
            current_rule_number = None
            current_rule_lines = []
            return
        if current_section_title:
            display = f"{current_section_title} — Rule {current_rule_number}: {rule_text}"
        else:
            display = f"Rule {current_rule_number}: {rule_text}"
        chunks.append(
            {
                "rule_number": current_rule_number,
                "rule_text": display,
            }
        )
        current_rule_number = None
        current_rule_lines = []

    def flush_pending_section() -> None:
        nonlocal pending_section_lines, current_section_title
        if not pending_section_lines:
            return
        combined = " ".join(s.strip() for s in pending_section_lines if s.strip())
        m = SECTION_HEADER_RE.match(pending_section_lines[0].strip())
        if not m:
            pending_section_lines = []
            return
        title = m.group(2).strip()
        major = m.group(1)
        if len(combined) < 80:
            current_section_title = title
        else:
            current_section_title = title
            chunks.append(
                {
                    "rule_number": f"{major}.",
                    "rule_text": f"Rule {major}.: {combined}",
                }
            )
        pending_section_lines = []

    for line in lines:
        line = line.strip()
        if not line:
            continue

        kind, rule_num, rest = _parse_rule_line(line)

        if kind == "rule":
            flush_pending_section()
            flush_chunk()
            current_rule_number = rule_num
            current_rule_lines = [rest] if rest else []
            continue

        if kind == "section":
            flush_chunk()
            flush_pending_section()
            pending_section_lines = [line]
            continue

        if pending_section_lines:
            pending_section_lines.append(line)
            continue

        if current_rule_number and not re.match(r"^[A-Z][a-z]+$", line):
            current_rule_lines.append(line)

    flush_chunk()
    flush_pending_section()

    print(f"Chunked into {len(chunks):,} rule segments")
    return chunks


# ─────────────────────────────────────────────
# STEP 3 — EMBED CHUNKS VIA VOYAGE AI
# ─────────────────────────────────────────────

def embed_chunks(chunks: list[dict], vo: voyageai.Client) -> list[dict]:
    """
    Generate embeddings for each chunk in batches using Voyage AI.
    voyage-3.5: 1024 dimensions, Anthropic-recommended embedding model.
    Entire CR is ~200k tokens → cost < $0.01
    input_type="document" tells Voyage these are passages to be retrieved
    (as opposed to "query" which is used at search time).
    """
    print(f"\nEmbedding {len(chunks):,} chunks using {EMBEDDING_MODEL}...")
    total_batches = (len(chunks) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_idx in range(total_batches):
        start = batch_idx * BATCH_SIZE
        end = min(start + BATCH_SIZE, len(chunks))
        batch = chunks[start:end]

        texts = [c["rule_text"] for c in batch]

        try:
            result = vo.embed(texts, model=EMBEDDING_MODEL, input_type="document")
            for i, embedding in enumerate(result.embeddings):
                chunks[start + i]["embedding"] = embedding

            print(f"  Batch {batch_idx + 1}/{total_batches} embedded ({end}/{len(chunks)} chunks)")

        except Exception as e:
            print(f"  Error embedding batch {batch_idx + 1}: {e}")
            time.sleep(5)  # back off on error
            continue

        time.sleep(0.1)  # gentle rate limiting

    embedded = [c for c in chunks if "embedding" in c]
    print(f"\nSuccessfully embedded {len(embedded):,} chunks")
    return embedded


# ─────────────────────────────────────────────
# STEP 4 — UPLOAD TO SUPABASE
# ─────────────────────────────────────────────

def upload_to_supabase(chunks: list[dict], supabase_client) -> None:
    """
    Upload embedded chunks to Supabase pgvector table.
    Clears existing data first to allow clean re-runs on rules updates.
    """
    print(f"\nUploading to Supabase...")

    # Clear existing rules (for clean re-runs on CR updates)
    print("  Clearing existing rules data...")
    supabase_client.table("comprehensive_rules").delete().neq("id", 0).execute()

    # Upload in batches
    total_batches = (len(chunks) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_idx in range(total_batches):
        start = batch_idx * BATCH_SIZE
        end = min(start + BATCH_SIZE, len(chunks))
        batch = chunks[start:end]

        rows = [
            {
                "rule_number": c["rule_number"],
                "rule_text": c["rule_text"],
                "embedding": c["embedding"],
                "cr_version": CR_VERSION,
            }
            for c in batch
        ]

        try:
            supabase_client.table("comprehensive_rules").insert(rows).execute()
            print(f"  Batch {batch_idx + 1}/{total_batches} uploaded ({end}/{len(chunks)} rows)")
        except Exception as e:
            print(f"  Error uploading batch {batch_idx + 1}: {e}")

        time.sleep(0.1)

    print(f"\nUpload complete — {len(chunks):,} rules in Supabase")


# ─────────────────────────────────────────────
# STEP 5 — VERIFY WITH A TEST QUERY
# ─────────────────────────────────────────────

def test_retrieval(query: str, vo: voyageai.Client, supabase_client) -> None:
    """
    Run a test similarity search to verify the pipeline works end-to-end.
    Note: queries use input_type="query" (different from "document" used at index time).
    """
    print(f"\nTest query: '{query}'")

    # Embed the query — use input_type="query" for search-time embeddings
    result = vo.embed([query], model=EMBEDDING_MODEL, input_type="query")
    query_embedding = result.embeddings[0]

    # Search Supabase
    result = supabase_client.rpc(
        "match_rules",
        {
            "query_embedding": query_embedding,
            "match_count": 5
        }
    ).execute()

    if result.data:
        print(f"Top 5 matching rules:")
        for i, row in enumerate(result.data):
            print(f"  {i+1}. Rule {row['rule_number']}: {row['rule_text'][:100]}...")
    else:
        print("No results — check that the match_rules function is created in Supabase (see README below)")


# ─────────────────────────────────────────────
# SUPABASE SETUP REQUIRED
# ─────────────────────────────────────────────
# Before running this script, run these two SQL blocks
# in your Supabase SQL Editor:
#
# -- 1. Table (uses 1024 dimensions for Voyage AI)
# create extension if not exists vector;
# create table comprehensive_rules (
#   id bigserial primary key,
#   rule_number text,
#   rule_text text,
#   embedding vector(1024)
# );
# create index on comprehensive_rules
# using ivfflat (embedding vector_cosine_ops)
# with (lists = 100);
#
# -- 2. Similarity search function
# create or replace function match_rules(
#   query_embedding vector(1024),
#   match_count int default 5
# )
# returns table (
#   id bigint,
#   rule_number text,
#   rule_text text,
#   similarity float
# )
# language sql stable
# as $$
#   select
#     id,
#     rule_number,
#     rule_text,
#     1 - (embedding <=> query_embedding) as similarity
#   from comprehensive_rules
#   order by embedding <=> query_embedding
#   limit match_count;
# $$;
# ─────────────────────────────────────────────


# ─────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────

if __name__ == "__main__":
    # Validate env vars
    missing = [k for k, v in {
        "VOYAGE_API_KEY": VOYAGE_API_KEY,
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_SERVICE_KEY": SUPABASE_KEY,
    }.items() if not v]

    if missing:
        print(f"Missing environment variables: {', '.join(missing)}")
        print("Add them to your .env file and try again.")
        exit(1)

    # Init clients
    vo = voyageai.Client(api_key=VOYAGE_API_KEY)
    supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Run pipeline
    cr_text = download_cr(CR_URL, CR_LOCAL_FILE)
    chunks = chunk_rules(cr_text)
    embedded_chunks = embed_chunks(chunks, vo)
    upload_to_supabase(embedded_chunks, supabase_client)

    # Verify with a test query
    test_retrieval(
        "deathtouch first strike combat damage",
        vo,
        supabase_client
    )

    print("\nSetup complete. Your CR vector DB is ready.")
    print("Next step: update mtg_judge_test.py to use RAG retrieval instead of hardcoded snippets.")
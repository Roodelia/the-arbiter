"""
MTG AI Judge — Refactored Test Script (RAG + Two-Call Architecture)
=====================================================================
Tests the full RAG pipeline with Supabase/Voyage AI and the two-call
hybrid ruling flow:

  Call 1 — /categories: Given card oracle texts, generate 3-5 relevant
            interaction category options for the player to choose from.

  Call 2 — /ruling: Given cards + optional category + optional situation,
            retrieve relevant CR chunks via RAG and generate a cited ruling.

The hybrid situation approach means:
  - If a situation AND/OR category is provided → focused ruling
  - If neither is provided → app deduces all relevant interactions

Prerequisites:
    py -m pip install anthropic voyageai supabase python-dotenv requests

.env file required:
    ANTHROPIC_API_KEY=your_key
    VOYAGE_API_KEY=your_key
    SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_SERVICE_KEY=your_service_role_key

Usage:
    py mtg_judge_test.py          # run all 15 test cases
    py mtg_judge_test.py 3        # run first 3 only (smoke test)
    py mtg_judge_test.py --score  # re-print scoring summary from saved results

Results saved to: mtg_judge_results.json
"""

import os
import sys
import json
import time
import requests
import anthropic
import voyageai
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────

ANTHROPIC_API_KEY  = os.environ.get("ANTHROPIC_API_KEY")
VOYAGE_API_KEY     = os.environ.get("VOYAGE_API_KEY")
SUPABASE_URL       = os.environ.get("SUPABASE_URL")
SUPABASE_KEY       = os.environ.get("SUPABASE_SERVICE_KEY")

MODEL              = "claude-sonnet-4-6"
EMBEDDING_MODEL    = "voyage-3.5"
RAG_TOP_K          = 5       # number of CR chunks to retrieve per query
OUTPUT_FILE        = "mtg_judge_results.json"


# ─────────────────────────────────────────────
# SYSTEM PROMPTS
# ─────────────────────────────────────────────

# Used in Call 1 — category generation
# Deliberately lightweight: no CR retrieval, just oracle text analysis
CATEGORIES_SYSTEM_PROMPT = """You are an expert Magic: The Gathering judge.
Given the oracle text of one or more cards, identify the most relevant 
interaction categories a player might want to ask about.

Respond ONLY with a valid JSON array of 3-5 short category label strings.
No preamble, no explanation, no markdown — just the raw JSON array.

Examples of good category labels:
- "Combat Damage Assignment"
- "Deathtouch Lethal Damage"
- "First Strike Step Ordering"
- "Enters the Battlefield Triggers"
- "Replacement Effects"
- "Commander Damage Tracking"
- "Hexproof Targeting Restriction"
- "Trample Damage Overflow"
- "State-Based Actions"
- "Priority and the Stack"
- "Continuous Effects and Layers"
- "Layer 7 Power and Toughness Order"
- "Timestamp Order of Effects"
- "Dependency Between Layer Effects"

Choose only categories that are genuinely relevant to the specific cards provided."""


# Used in Call 2 — full ruling
# Strict about citations, covers hybrid situation/deduction approach
RULING_SYSTEM_PROMPT = """You are an expert Magic: The Gathering judge assistant. 
Your role is to provide accurate, cited rulings for game situations.

When answering, you MUST:
1. State the ruling clearly and directly at the start
2. Cite the specific Comprehensive Rules section(s) that apply (e.g. "Rule 702.2b")
3. Reference the oracle text of relevant cards where applicable
4. Explain the reasoning step by step
5. If there is any ambiguity or edge case, note it explicitly

Format your response EXACTLY as:
RULING: [Clear one-sentence ruling]
EXPLANATION: [Step-by-step reasoning]
RULES CITED: [Rule numbers and brief descriptions, one per line]
CARD ORACLE TEXT REFERENCED: [Which cards and which parts of their text apply]

If no specific situation is given, identify and rule on ALL mechanically relevant 
interactions between the cards. Highlight interactions that are non-obvious or 
commonly misplayed.

Do NOT make up rule numbers. Only cite rules that appear in the provided context."""


# ─────────────────────────────────────────────
# TEST CASES
# situation is now optional (None = deduction mode)
# category is also optional (mirrors the UI chip selection)
# ─────────────────────────────────────────────

TEST_CASES = [
    # ── DEDUCTION MODE (no situation, no category) ──────────────────
    {
        "id": "TC01",
        "category": "Combat — Deathtouch + First Strike",
        "cards": ["Wasteland Viper", "Rumbling Baloth"],
        "situation": None,       # app deduces all interactions
        "selected_category": None,
        "expected_outcome": (
            "The 1/1 with Deathtouch and First Strike kills the 4/4 in the "
            "first combat damage step. The 4/4 is destroyed before it can "
            "deal damage in the second step. The 1/1 survives."
        ),
        "difficulty": "medium",
    },
    {
        "id": "TC02",
        "category": "Combat — Trample + Deathtouch",
        "cards": ["Polukranos, World Eater", "Grizzly Bears"],
        "situation": None,
        "selected_category": None,
        "expected_outcome": (
            "With Deathtouch, only 1 damage needs to be assigned to the "
            "blocker. Remaining 5 damage tramples through to the player."
        ),
        "difficulty": "medium",
    },
    {
        "id": "TC03",
        "category": "Hexproof — opponent targeting",
        "cards": ["Gladecover Scout", "Lightning Bolt"],
        "situation": None,
        "selected_category": None,
        "expected_outcome": (
            "Player B cannot target the Hexproof creature with Lightning Bolt. "
            "Hexproof prevents opponents from targeting the permanent."
        ),
        "difficulty": "easy",
    },

    # ── CATEGORY MODE (no situation, category selected) ──────────────
    {
        "id": "TC04",
        "category": "Indestructible + Deathtouch",
        "cards": ["Typhoid Rats", "Darksteel Myr"],
        "situation": None,
        "selected_category": "State-Based Actions",   # player tapped this chip
        "expected_outcome": (
            "Indestructible prevents destruction. Deathtouch would normally "
            "trigger SBA destruction but Indestructible overrides it. Creature survives."
        ),
        "difficulty": "medium",
    },
    {
        "id": "TC05",
        "category": "Commander Damage",
        "cards": ["Sol'Kanar the Swamp King", "Fireshrieker"],
        "situation": None,
        "selected_category": "Commander Damage Tracking",
        "expected_outcome": (
            "18 + 7 = 25 combat damage from the same commander. "
            "Exceeds the 21-damage threshold. Player loses the game."
        ),
        "difficulty": "easy",
    },
    {
        "id": "TC06",
        "category": "Priority — Responding to triggered ability",
        "cards": ["Reassembling Skeleton", "Tormod's Crypt"],
        "situation": None,
        "selected_category": "Priority and the Stack",
        "expected_outcome": (
            "Targeted triggers fizzle if the target is removed in response. "
            "Non-targeted triggers resolve regardless."
        ),
        "difficulty": "hard",
    },

    # ── HYBRID MODE (situation + category) ───────────────────────────
    {
        "id": "TC07",
        "category": "Layers — Power/Toughness modification",
        "cards": ["Grizzly Bears"],
        "situation": (
            "A -1/-1 effect and a +3/+3 effect are both applied to this creature. "
            "What is the final power and toughness?"
        ),
        "selected_category": "Continuous Effects and Layers",
        "expected_outcome": (
            "Effects applied in timestamp order in Layer 7. "
            "Either order results in 4/4."
        ),
        "difficulty": "hard",
    },
    {
        "id": "TC08",
        "category": "Replacement Effects — ETB conflict",
        "cards": ["Imposing Sovereign", "Leyline of Anticipation"],
        "situation": (
            "Two replacement effects conflict on how a creature enters. "
            "One says it enters tapped, the other says it enters untapped. Which wins?"
        ),
        "selected_category": "Replacement Effects",
        "expected_outcome": (
            "The affected permanent's controller chooses which replacement "
            "effect applies first. Player A chooses their own — creature enters untapped."
        ),
        "difficulty": "hard",
    },

    # ── SITUATION ONLY (no category selected) ────────────────────────
    {
        "id": "TC09",
        "category": "Combat — Trample double block",
        "cards": ["Craterhoof Behemoth", "Llanowar Elves", "Elvish Mystic"],
        "situation": (
            "A 5/5 with Trample is blocked by a 2/2 and a 3/3. "
            "Can the attacker assign 1 to the 2/2, 4 to the 3/3, and 0 trample?"
        ),
        "selected_category": None,
        "expected_outcome": (
            "No. Must assign lethal to ALL blockers first. 2+3=5 damage consumed. "
            "0 damage tramples through."
        ),
        "difficulty": "medium",
    },
    {
        "id": "TC10",
        "category": "State-Based Actions — 0 toughness",
        "cards": ["Black Knight"],
        "situation": (
            "A continuous effect reduces this creature's toughness to 0. "
            "Can the controller sacrifice it before state-based actions destroy it?"
        ),
        "selected_category": None,
        "expected_outcome": (
            "No. SBAs are checked before priority is received. "
            "Creature is gone before the controller can respond."
        ),
        "difficulty": "medium",
    },
    {
        "id": "TC11",
        "category": "Triggered Ability — simultaneous damage",
        "cards": ["Coastal Piracy"],
        "situation": (
            "A creature with 'Whenever this creature deals combat damage to a player, "
            "draw a card' deals damage to two players simultaneously. How many cards drawn?"
        ),
        "selected_category": None,
        "expected_outcome": (
            "Trigger fires once per event. Two players damaged = two triggers. "
            "Controller draws 2 cards."
        ),
        "difficulty": "hard",
    },
    {
        "id": "TC12",
        "category": "Hexproof — own spells",
        "cards": ["Slippery Bogle", "Giant Growth"],
        "situation": "Can the controller of the Hexproof creature target it with Giant Growth?",
        "selected_category": None,
        "expected_outcome": (
            "Yes. Hexproof only prevents opponents from targeting. "
            "The controller can freely target their own Hexproof creature."
        ),
        "difficulty": "easy",
    },
    {
        "id": "TC13",
        "category": "Commander — Zone changes + damage tracking",
        "cards": [],
        "situation": (
            "A commander is destroyed. Can the owner put it in the command zone? "
            "Does commander damage reset?"
        ),
        "selected_category": "Commander Damage Tracking",
        "expected_outcome": (
            "Yes, commander can go to command zone instead of graveyard. "
            "Commander damage does NOT reset across zone changes."
        ),
        "difficulty": "medium",
    },
    {
        "id": "TC14",
        "category": "Deathtouch + multiple blockers",
        "cards": ["Glissa, the Traitor", "Grizzly Bears"],
        "situation": (
            "A 4/4 with Deathtouch is blocked by two 2/2 creatures. "
            "How does the attacker assign damage?"
        ),
        "selected_category": "Combat Damage Assignment",
        "expected_outcome": (
            "1 damage to each blocker (Deathtouch = lethal). "
            "Remaining 2 damage cannot trample (no Trample). Both blockers destroyed."
        ),
        "difficulty": "medium",
    },
    {
        "id": "TC15",
        "category": "Indestructible + Exile",
        "cards": ["Darksteel Colossus", "Swords to Plowshares"],
        "situation": "Does Indestructible protect against Swords to Plowshares?",
        "selected_category": None,
        "expected_outcome": (
            "No. Indestructible prevents destruction only. "
            "Swords to Plowshares exiles — Indestructible does not protect against exile."
        ),
        "difficulty": "easy",
    },
]


# ─────────────────────────────────────────────
# SCRYFALL HELPER
# ─────────────────────────────────────────────

def fetch_oracle_text(card_name: str) -> dict:
    """Fetch card oracle text from Scryfall fuzzy search."""
    url = "https://api.scryfall.com/cards/named"
    params = {"fuzzy": card_name}
    try:
        response = requests.get(url, params=params, timeout=5)
        if response.status_code == 200:
            data = response.json()
            return {
                "name": data.get("name", card_name),
                "oracle_text": data.get("oracle_text", "[No oracle text found]"),
                "type_line": data.get("type_line", ""),
                "power": data.get("power", ""),
                "toughness": data.get("toughness", ""),
            }
    except Exception as e:
        print(f"  Warning: Could not fetch '{card_name}' from Scryfall: {e}")
    return {"name": card_name, "oracle_text": "[Could not fetch oracle text]"}


def format_oracle_block(cards: list[dict]) -> str:
    """Format fetched card data into a readable block for prompt injection."""
    if not cards:
        return "[No cards provided]"
    return "\n\n".join(
        f"Card: {c['name']}\n"
        f"Type: {c.get('type_line', 'Unknown')}\n"
        f"Oracle Text: {c['oracle_text']}"
        + (f"\nP/T: {c['power']}/{c['toughness']}" if c.get('power') else "")
        for c in cards
    )


# ─────────────────────────────────────────────
# CALL 1 — CATEGORY GENERATION
# ─────────────────────────────────────────────

def generate_categories(
    cards: list[dict],
    anthropic_client: anthropic.Anthropic
) -> list[str]:
    """
    Call 1: Given card oracle texts, generate 3-5 relevant interaction
    category options. Returns a list of category label strings.
    Fast and cheap — no RAG retrieval needed.
    """
    oracle_block = format_oracle_block(cards)

    prompt = f"""CARD ORACLE TEXT:
{oracle_block}

Based on these cards, what are the most relevant interaction categories 
a player might want to ask a judge about?

Return ONLY a JSON array of 3-5 short category label strings."""

    try:
        message = anthropic_client.messages.create(
            model=MODEL,
            max_tokens=200,
            system=CATEGORIES_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = message.content[0].text.strip()
        # Strip any accidental markdown fences
        raw = raw.replace("```json", "").replace("```", "").strip()
        categories = json.loads(raw)
        return categories if isinstance(categories, list) else []
    except Exception as e:
        print(f"  Warning: Category generation failed: {e}")
        return []


# ─────────────────────────────────────────────
# CALL 2 — RAG RETRIEVAL
# ─────────────────────────────────────────────

def retrieve_cr_chunks(
    cards: list[dict],
    situation: str | None,
    selected_category: str | None,
    vo: voyageai.Client,
    supabase_client
) -> str:
    """
    Build a retrieval query from the cards + context, embed it with Voyage AI,
    and retrieve the top-K most relevant CR chunks from Supabase pgvector.
    Returns a formatted string of rule chunks for prompt injection.
    """
    # Build retrieval query — combine card names, keywords from oracle text,
    # and any category/situation context
    card_names = " ".join(c["name"] for c in cards)
    keywords = " ".join(
        word for c in cards
        for word in c.get("oracle_text", "").split()
        if word.istitle() and len(word) > 4  # catch ability keywords like Deathtouch
    )
    context = " ".join(filter(None, [selected_category, situation]))
    query = f"{card_names} {keywords} {context}".strip()

    try:
        # Embed the query — input_type="query" for search-time embeddings
        result = vo.embed([query], model=EMBEDDING_MODEL, input_type="query")
        query_embedding = result.embeddings[0]

        # Retrieve from Supabase
        response = supabase_client.rpc(
            "match_rules",
            {
                "query_embedding": query_embedding,
                "match_count": RAG_TOP_K
            }
        ).execute()

        if response.data:
            chunks = "\n\n---\n\n".join(
                f"Rule {row['rule_number']}: {row['rule_text']}"
                for row in response.data
            )
            return chunks
        else:
            return "[No relevant rules retrieved from database]"

    except Exception as e:
        print(f"  Warning: RAG retrieval failed: {e}")
        return "[RAG retrieval failed — proceeding without CR context]"


# ─────────────────────────────────────────────
# CALL 2 — BUILD PROMPT (HYBRID)
# ─────────────────────────────────────────────

def build_ruling_prompt(
    cards: list[dict],
    cr_chunks: str,
    situation: str | None,
    selected_category: str | None
) -> str:
    """
    Assemble the full ruling prompt.
    Hybrid approach:
      - situation + category provided → focused ruling on that context
      - category only → focus on that interaction type across all cards
      - situation only → answer the specific question asked
      - neither → deduce and rule on all relevant interactions
    """
    oracle_block = format_oracle_block(cards)

    # Build the context section based on what's available
    if situation and selected_category:
        context_section = (
            f"FOCUS AREA: {selected_category}\n\n"
            f"GAME SITUATION:\n{situation}"
        )
    elif selected_category:
        context_section = (
            f"FOCUS AREA: {selected_category}\n\n"
            f"INSTRUCTION: Analyse these cards and provide a ruling focused on "
            f"'{selected_category}'. Cover all relevant interactions in this area."
        )
    elif situation:
        context_section = f"GAME SITUATION:\n{situation}"
    else:
        context_section = (
            "INSTRUCTION: No specific situation has been described. "
            "Analyse these cards and identify ALL mechanically relevant interactions "
            "between them. Provide a ruling for each. Highlight any interactions that "
            "are non-obvious or commonly misplayed at the Commander table."
        )

    return f"""RELEVANT COMPREHENSIVE RULES (retrieved via RAG):
{cr_chunks}

CARD ORACLE TEXT (from Scryfall):
{oracle_block}

{context_section}

Please provide a ruling."""


# ─────────────────────────────────────────────
# MAIN TEST RUNNER
# ─────────────────────────────────────────────

def run_tests(test_cases: list, limit: int = None) -> list:
    """
    Run all test cases through the two-call pipeline and return results.
    Each test case exercises:
      - Call 1: category generation
      - Call 2: RAG retrieval + ruling
    """
    # Validate env vars
    missing = [k for k, v in {
        "ANTHROPIC_API_KEY": ANTHROPIC_API_KEY,
        "VOYAGE_API_KEY": VOYAGE_API_KEY,
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_SERVICE_KEY": SUPABASE_KEY,
    }.items() if not v]
    if missing:
        print(f"Missing environment variables: {', '.join(missing)}")
        print("Add them to your .env file and try again.")
        sys.exit(1)

    # Init clients
    anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    vo = voyageai.Client(api_key=VOYAGE_API_KEY)
    supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)

    results = []
    cases_to_run = test_cases[:limit] if limit else test_cases

    print(f"\n{'='*60}")
    print(f"MTG AI Judge — RAG Test Run (Two-Call Architecture)")
    print(f"Running {len(cases_to_run)} test cases...")
    print(f"{'='*60}\n")

    for i, tc in enumerate(cases_to_run):
        mode = (
            "deduction" if not tc["situation"] and not tc["selected_category"]
            else "category" if not tc["situation"]
            else "hybrid" if tc["selected_category"]
            else "situation"
        )
        print(f"[{i+1}/{len(cases_to_run)}] {tc['id']} [{mode.upper()}] — {tc['category']}")

        # ── Fetch oracle text ────────────────────────────────────────
        cards = []
        for card_name in tc["cards"]:
            print(f"  Fetching: {card_name}...")
            card_data = fetch_oracle_text(card_name)
            cards.append(card_data)
            time.sleep(0.1)

        # ── Call 1: Generate categories ──────────────────────────────
        generated_categories = []
        if cards:
            print(f"  Generating categories...")
            generated_categories = generate_categories(cards, anthropic_client)
            print(f"  Categories: {generated_categories}")
        time.sleep(0.3)

        # ── Call 2a: RAG retrieval ───────────────────────────────────
        print(f"  Retrieving CR chunks via RAG...")
        cr_chunks = retrieve_cr_chunks(
            cards,
            tc["situation"],
            tc["selected_category"],
            vo,
            supabase_client
        )
        retrieved_count = cr_chunks.count("Rule ") if "Rule " in cr_chunks else 0
        print(f"  Retrieved {retrieved_count} CR chunks")

        # ── Call 2b: Generate ruling ─────────────────────────────────
        prompt = build_ruling_prompt(
            cards,
            cr_chunks,
            tc["situation"],
            tc["selected_category"]
        )

        try:
            message = anthropic_client.messages.create(
                model=MODEL,
                max_tokens=1024,
                system=RULING_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}]
            )
            llm_response = message.content[0].text
            print(f"  ✓ Ruling received ({len(llm_response)} chars)")
        except Exception as e:
            llm_response = f"ERROR: {e}"
            print(f"  ✗ Error: {e}")

        result = {
            "id": tc["id"],
            "category": tc["category"],
            "difficulty": tc["difficulty"],
            "mode": mode,
            "cards": tc["cards"],
            "situation": tc["situation"],
            "selected_category": tc["selected_category"],
            "generated_categories": generated_categories,
            "cr_chunks_retrieved": retrieved_count,
            "expected_outcome": tc["expected_outcome"],
            "llm_response": llm_response,
            # Manual scoring fields — fill in after reviewing
            "score": None,              # 0 = wrong, 0.5 = partial, 1 = correct
            "has_rule_citation": None,  # True/False
            "categories_relevant": None, # True/False — were generated categories useful?
            "notes": "",
        }
        results.append(result)
        print()
        time.sleep(0.5)

    return results


# ─────────────────────────────────────────────
# SCORING
# ─────────────────────────────────────────────

def score_summary(results: list):
    """Print scoring summary broken down by mode and difficulty."""
    scored = [r for r in results if r["score"] is not None]
    if not scored:
        print("\n[No scores yet — fill in 'score' fields in the JSON and re-run with --score]")
        return

    total = len(scored)
    correct = sum(1 for r in scored if r["score"] == 1)
    partial = sum(1 for r in scored if r["score"] == 0.5)
    wrong = sum(1 for r in scored if r["score"] == 0)
    has_citations = sum(1 for r in scored if r.get("has_rule_citation"))
    good_categories = sum(1 for r in scored if r.get("categories_relevant"))

    print(f"\n{'='*60}")
    print(f"SCORING SUMMARY")
    print(f"{'='*60}")
    print(f"Total scored:         {total}")
    print(f"Correct (1.0):        {correct} ({correct/total*100:.0f}%)")
    print(f"Partial (0.5):        {partial} ({partial/total*100:.0f}%)")
    print(f"Wrong (0.0):          {wrong} ({wrong/total*100:.0f}%)")
    print(f"With citations:       {has_citations} ({has_citations/total*100:.0f}%)")
    print(f"Relevant categories:  {good_categories} ({good_categories/total*100:.0f}%)")
    print(f"Accuracy score:       {(correct + partial*0.5)/total*100:.1f}%")

    print(f"\nBy difficulty:")
    for diff in ["easy", "medium", "hard"]:
        group = [r for r in scored if r["difficulty"] == diff]
        if group:
            acc = sum(r["score"] for r in group) / len(group) * 100
            print(f"  {diff.capitalize():8s}: {acc:.0f}% ({len(group)} cases)")

    print(f"\nBy mode:")
    for mode in ["deduction", "category", "hybrid", "situation"]:
        group = [r for r in scored if r.get("mode") == mode]
        if group:
            acc = sum(r["score"] for r in group) / len(group) * 100
            print(f"  {mode.capitalize():12s}: {acc:.0f}% ({len(group)} cases)")

    # Decision threshold guidance
    print(f"\n{'='*60}")
    print(f"DECISION THRESHOLDS")
    print(f"{'='*60}")
    overall = (correct + partial * 0.5) / total * 100
    citation_rate = has_citations / total * 100
    print(f"Overall accuracy:  {overall:.0f}%  (target: ≥80% to proceed)")
    print(f"Citation rate:     {citation_rate:.0f}%  (target: ≥85% to proceed)")
    easy_group = [r for r in scored if r["difficulty"] == "easy"]
    if easy_group:
        easy_acc = sum(r["score"] for r in easy_group) / len(easy_group) * 100
        print(f"Easy accuracy:     {easy_acc:.0f}%  (target: 100%)")


def print_results(results: list):
    """Print results to console for quick review."""
    print(f"\n{'='*60}")
    print("RESULTS")
    print(f"{'='*60}")
    for r in results:
        print(f"\n--- {r['id']} [{r['difficulty'].upper()}] [{r.get('mode','?').upper()}] ---")
        print(f"Category: {r['category']}")
        if r['situation']:
            print(f"Situation: {r['situation'][:120]}...")
        if r['selected_category']:
            print(f"Selected category: {r['selected_category']}")
        print(f"Generated categories: {r.get('generated_categories', [])}")
        print(f"CR chunks retrieved: {r.get('cr_chunks_retrieved', 0)}")
        print(f"\nExpected: {r['expected_outcome'][:200]}...")
        print(f"\nLLM Response:\n{r['llm_response'][:500]}...")
        print(f"\n{'─'*40}")


# ─────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────

if __name__ == "__main__":
    # --score flag: re-print summary from saved results without re-running
    if "--score" in sys.argv:
        try:
            with open(OUTPUT_FILE) as f:
                saved = json.load(f)
            score_summary(saved)
        except FileNotFoundError:
            print(f"No results file found at {OUTPUT_FILE}. Run the tests first.")
        sys.exit(0)

    # Optional limit: py mtg_judge_test.py 3
    limit = None
    for arg in sys.argv[1:]:
        if arg.isdigit():
            limit = int(arg)

    results = run_tests(TEST_CASES, limit=limit)

    # Save results for manual scoring
    with open(OUTPUT_FILE, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved to: {OUTPUT_FILE}")

    print_results(results)
    score_summary(results)

    print(f"\nNext steps:")
    print(f"  1. Open {OUTPUT_FILE}")
    print(f"  2. Fill in 'score' (0/0.5/1), 'has_rule_citation' (true/false),")
    print(f"     and 'categories_relevant' (true/false) for each result")
    print(f"  3. Run: py mtg_judge_test.py --score")
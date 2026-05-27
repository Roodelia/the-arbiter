---
description: 
alwaysApply: true
---

# ManaJudge — Project Context

## App Name
ManaJudge

## What This App Is
An AI-powered Magic: The Gathering rules judge companion. Players input
cards involved in a dispute and the app generates an accurate, cited verdict.
Positioned as an at-the-table companion — not a life tracker or deckbuilder.

## Target User
Casual MTG players who encounter rules disputes during games.

## Tech Stack
- React Native with Expo (TypeScript)
- Backend: Express.js server (handles all API calls — keys never on device)
- LLM: Anthropic Claude — claude-haiku-4-5-20251001 for category generation; claude-sonnet-4-6 for rulings
- Embeddings: Voyage AI (voyage-3.5, 1024 dimensions)
- Vector DB: Supabase pgvector (comprehensive_rules table)
- CR indexing: scripts/embed_rules.py chunks by rule number; stores `rule_text` (display, with section/rule prefixes) and `rule_text_for_embedding` (clean text for Voyage). Each chunk has `parent_rule_number` (null for base rules like `702.15`, set for lettered subrules like `702.15a -> 702.15`). Re-run when Wizards publishes a new CR file.
- Card data: Scryfall API (free, no auth, fuzzy name search + rulings endpoint)
- Analytics: Vercel Analytics

## Hosting
- Frontend: Vercel (https://manajudge.com)
- Backend: Railway (https://manajudge-production.up.railway.app)
- Database: Supabase

## Architecture
All API keys live on the backend Express server. 
The React Native app calls the backend only — never Anthropic, Voyage, or Supabase directly.
Express uses `trust proxy` (one hop) so `req.ip` and rate limiting align with the real client when the app runs behind Railway.

### Backend Endpoints
POST /categories
  - Input: { cards: string[] }
  - Fetches Scryfall oracle text + official WotC rulings per card
  - Calls Claude Haiku with a curated `CATEGORY_ANCHORS` list; model must pick from anchors when one fits (1–4 labels, free-form only if no anchor fits)
  - Returns: { categories: string[] }

POST /ruling
  - Input: { cards: string[], case_id?: string, situation?: string, category?: string }
  - Fetches Scryfall oracle text + official WotC rulings per card
  - Builds Voyage query from card oracle texts + situation + category; embeds with voyage-3.5 (`inputType: "query"`)
  - Vector search: Supabase `match_rules` with `match_count: 8`
  - **Retrieval anchors** (`RETRIEVAL_ANCHORS`): regex patterns on situation + oracle text inject specific CR rules (e.g. ability loss → 613.1) if not already in vector hits; marked `anchored: true` in `rag_matches`
  - **Parent/sibling expansion**: top **2** vector hits (not 3) expand to related rules — parent + siblings, or children if hit is a base rule — reranked by cosine similarity to query, up to 5 per hit; skipped for rules on `EXPANSION_BLOCKLIST` (e.g. 702, 704.5)
  - Merges vector + anchored + expanded rules; sorts anchored first, then semantic hits, then expanded; caps context at **12** rules (`RAG_CONTEXT_CAP`) — anchored kept, then semantic, then expanded fill remainder
  - Calls Claude Sonnet (`claude-sonnet-4-6`) with cached `RULING_SYSTEM_PROMPT`; user message includes CARD DATA block, RAG CR chunks, official Scryfall rulings, and situation/category focus instructions
  - Parses model output (`parseRulingResponse`); resolves `RULES CITED` rule numbers to full CR text from Supabase (exact match, then fuzzy prefix)
  - Optional: if `case_id` provided, fire-and-forget upsert of `rag_matches` to `cases` table
  - Sends Telegram alert on successful ruling (if configured)
  - Returns: { ruling, explanation, rules_cited, oracle_referenced, cr_version, rag_matches }
  - `rag_matches`: { rule_number, similarity, expanded, anchored, anchor_label? } per rule sent to the model

POST /log
  - Input: { session_id, case_id, cards, selected_category?,
             situation?, ruling?, explanation?, rules_cited?,
             cr_version?, rag_matches?,
             flagged?, flag_reason? }
  - Upserts case record to Supabase cases table by case_id; sets ip_address
    from X-Forwarded-For (first hop) or req.ip (trust proxy enabled for Railway)
  - Returns: { success: true, id } (id = cases row id)

POST /share
  - Input: { case_id?, cards, category? (string or string[]), situation?, ruling, explanation, rules_cited, cr_version? }
  - Generates short 8-char alphanumeric ID
  - Inserts into Supabase shared_rulings table
  - Returns: { success: true, id, url }

GET /share/featured
  - Reads featured shared rulings where featured = true
  - Ordered by created_at descending, limited to 5
  - Returns: Shared ruling array
  - No rate limiting on this endpoint

GET /share/:id
  - Looks up shared ruling by ID from shared_rulings table
  - Returns: { id, cards, category, situation, ruling, explanation, rules_cited, cr_version, created_at }
  - 404 if not found

## Scryfall Integration
- Two calls per card: /cards/named?fuzzy= (oracle text) + /cards/{id}/rulings
- 100ms delay between requests to respect rate limits (max 10 req/sec)
- Autocomplete via /cards/autocomplete, debounced 250ms, shows up to 12 suggestions
- image_uris.normal used for card images — falls back to card_faces for DFCs

## Two-Call Flow
1. Player adds 1+ cards → app auto-calls /categories → displays chips
2. Player optionally taps a chip and/or types a situation
3. Player taps "Get Verdict" (Step 2) → calls /ruling → displays result

## Hybrid Situation Approach
- Cards only → app deduces all relevant interactions (deduction mode)
- Cards + one or more category chips → focused ruling (categories sent as a comma-joined string to /ruling)
- Cards + typed situation → answers the specific question
- Cards + both → fully focused ruling

## Ruling Output Format
(Model is instructed: RULING must match the EXPLANATION, final answer only on the RULING line — no mechanistic reasoning there.)
RULING: [one sentence]
EXPLANATION: [step by step / bullets]
RULES CITED: [Claude outputs rule numbers only; backend resolves to exact Comprehensive Rules text before returning]
CARD ORACLE TEXT REFERENCED: [relevant card text]

## Three-Step UX Flow
Step 1 — Specify Cards
  - Tagline: "Instant rulings for Magic: The Gathering interactions"
  - Usage cue: "Select cards. Describe the interactions. Get answers."
  - Card search input with Scryfall autocomplete (12 results max)
  - Selected cards shown as chips (removable)
  - Card image carousel (full width, swipeable, max 400px on desktop)
  - Most recently added card shown in carousel
  - Max 4 cards
  - "Ask ManaJudge" button (enabled at 1+ cards)
  - Optional "Featured Rulings" section below action button (if available)

Step 2 — Select Context
  - Selected cards shown (removable)
  - Auto-fetches /categories on entry (1+ cards)
  - Category chips (multi-select; selected chips use bgAccent violet fill / white text)
  - Optional situation text input
  - "Get Verdict" primary button (shows "Deliberating…" spinner while loading)
  - "← reselect cards" link below

Step 3 — View Verdict
  - Selected cards shown as tappable chips (open card image modal on tap)
  - Selected categories shown (if any), labelled "Interaction / Scenario"
  - Verdict card: gold focus strip, "VERDICT" title, ruling text
  - Collapsible EXPLANATION section (chevron toggle, bullet points)
  - Collapsible RULES CITED section (chevron toggle, tappable rule tags → modal with full CR text; backdrop tap or ✕ to dismiss)
  - Actions below divider:
    - "Ask another question" (primary, full-width — resets all state)
    - "Share this verdict" (confirm-colored fill; Sharing… / ✓ Link copied!)
    - "← Describe the scenario again" (text link back to Step 2)
    - "Flag this Verdict" (error-colored text action)
  - Flag flow: immediate logCase on tap → modal for optional reason → confirm

## Usage Logging (Supabase cases table)
Logged across the flow (same case_id, upserted):
1. On "Ask ManaJudge" tap (Step 1) → cards only
2. On "Get Verdict" tap → cards + category + situation
3. On ruling received → full case including verdict, cr_version, rag_matches
4. On flag → flagged: true + flag_reason

Each case uses a UUID case_id (upserted, not inserted) so partial
sessions appear as one row with null fields for incomplete steps.
session_id groups multiple cases from the same app session.
ip_address (text, nullable) stores the client IP for each upsert.
Images are never stored — only card names.

## Database (Supabase)
- **comprehensive_rules** — CR chunks with pgvector embeddings; columns include rule_number, rule_text, rule_text_for_embedding, parent_rule_number, embedding (vector(1024)), cr_version (text); index on `parent_rule_number` for expansion queries
- **cases** — usage logging (see Usage Logging above); includes ip_address (add via backend/sql/add_cases_ip_address.sql if missing)
- **shared_rulings** — id (text PK), case_id (FK to cases), cards, category, situation, ruling, explanation, rules_cited, cr_version, created_at

## Rate Limiting
- 60 requests per hour per IP address
- Applies to /categories, /ruling, /log, and /share endpoints
- Exception: GET /share/featured is read-only and not rate-limited
- 429 response shows friendly message in UI

## Colour Palette & Typography
- Use `constants/theme.ts` as the source of truth for colours (`COLOURS`), fonts (`TITLE_FONT`, `BODY_FONT`), and shared UI constants (`GENERIC_ERROR_MESSAGE`). Do not duplicate hex values or token names here.

## Logo
- Primary in-app title asset: `assets/images/manajudge_title.png` (used in main and shared pages)
- Legacy SVG wordmark file retained: `assets/images/manajudge_logo.svg`

## UI Requirements
- Dark theme — players use this in low-light table conditions
- High contrast text, large tap targets (min 44px height)
- Minimal friction — optimised for quick lookup during an active game
- No overscroll bounce (bounces={false}, overScrollMode="never")
- No auto-zoom on input focus (fontSize: 16 on all inputs)
- maximum-scale=1 in viewport meta tag
- **Page scroll content** (main app `app/index.tsx` ScrollView `contentContainerStyle`; shared ruling `app/ruling/[id].tsx` `styles.scrollContent`): `paddingHorizontal` 16, `paddingTop` 12, `paddingBottom` 24; `maxWidth` 600, `width` `'100%'`, `alignSelf` `'center'`, `flexGrow` 1
- **Verdict card** (`step3RulingSection`): inner padding `paddingHorizontal` 16, `paddingTop` / `paddingBottom` 16 (inside the scroll padding above)
- **Primary CTAs** (`primaryActionButton`): `minHeight` 52, `paddingHorizontal` 16, `paddingVertical` 14
- **Text inputs** (`styles.input`): `minHeight` 44, `paddingHorizontal` 12, `paddingVertical` 6, `fontSize` 16 (situation / flag reason / search)
- Collapsible sections use chevron icons (▸ collapsed, ▾ expanded) in confirm color
- Card image modal on Step 3: tapping card chip opens full-size card image overlay

## Shared Ruling Page (app/ruling/[id].tsx)
- Fetches ruling from GET /share/:id
- Shows logo (tappable → home), tagline, divider
- Card chips (tappable → card image popup modal with lazy Scryfall image loading)
- Situation/interaction section if present (category labels + situation text)
- Verdict card (same styling as Step 3)
- Collapsible Explanation and Rules Cited sections (rule tags open full-text modal, same as Step 3)
- CR version label at bottom right (formatted as "Comprehensive Rules (Mon DD, YYYY)")
- "Ask ManaJudge" button to navigate home

## Roadmap Phases
Phase 1 (current): AI Judge MVP — card search, verdict display, citations
Phase 2: Camera OCR card capture, web search augmentation, similar mechanics
Phase 3: Life tracker, turn timer, wishlist with pricing
Phase 4: Community rulings, upvote/dispute, reputation system

## Key Files
- app/index.tsx — main app screen (all three steps)
- app/ruling/[id].tsx — shared ruling public page
- app/+html.tsx — web HTML wrapper (viewport, overscroll, analytics)
- app/_layout.tsx — Expo Router layout (headerShown: false)
- backend/server.js — Express backend (all API endpoints)
- backend/config/rag.js — RAG tunables (match count, expansion limits, context cap)
- backend/services/rag.js — RAG retrieval pipeline (anchors, expansion, cap)
- backend/data/retrieval-anchors.js — pattern-based CR rule injection for /ruling
- constants/theme.ts — shared colours/fonts/error constant (COLOURS object, TITLE_FONT, BODY_FONT, GENERIC_ERROR_MESSAGE)
- utils/scryfall.ts — shared `fetchCardImageUri` helper
- scripts/embed_rules.py — CR download, chunk (`rule_text` for display, `rule_text_for_embedding` for Voyage), embed, upload (stores cr_version per row)
- scripts/mtg_judge_test.py — Python test suite for the ruling engine
- CLAUDE.md — this file

## Coding Conventions
- TypeScript throughout
- Functional components with hooks
- StyleSheet for all styles (no NativeWind)
- All async calls wrapped in try/catch with user-visible error states
- logCase always fires and forgets — never blocks UI
- Images never stored in Supabase — card names only
- Environment variables for all backend URLs (EXPO_PUBLIC_BACKEND_URL)
- Abort controllers on all fetch calls (autocomplete, categories, ruling) to cancel in-flight requests on re-render

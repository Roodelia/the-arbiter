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
- CR indexing: scripts/embed_rules.py chunks by rule number; each chunk includes `parent_rule_number` (null for base rules like `702.15`, populated for lettered subrules like `702.15a -> 702.15`). The `comprehensive_rules` table includes an index on `parent_rule_number` for sibling expansion queries, and after vector search the top 3 hits are expanded to include parent/sibling rules before context is sent to Claude. Re-run when Wizards publishes a new CR file.
- Card data: Scryfall API (free, no auth, fuzzy name search + rulings endpoint)
- Analytics: Vercel Analytics

## Hosting
- Frontend: Vercel (https://manajudge.com)
- Backend: Railway (https://manajudge-production.up.railway.app)
- Database: Supabase

## Architecture
All API keys live on the backend Express server. The React Native app
calls the backend only — never Anthropic, Voyage, or Supabase directly.
Express uses `trust proxy` (one hop) so `req.ip` and rate limiting align
with the real client when the app runs behind Railway.

### Backend Endpoints
POST /categories
  - Input: { cards: string[] }
  - Fetches Scryfall oracle text + official WotC rulings per card
  - Calls Claude to generate 3-5 relevant interaction category labels
  - Returns: { categories: string[] }

POST /ruling
  - Input: { cards: string[], situation?: string, category?: string }
  - Fetches Scryfall oracle text + official WotC rulings per card
  - Embeds query with Voyage AI, retrieves top 8 CR chunks from Supabase (match_rules)
  - Calls Claude with retrieved CR context + oracle text + official rulings
  - Returns: { ruling, explanation, rules_cited, oracle_referenced, cr_version }

POST /log
  - Input: { session_id, case_id, cards, selected_category?,
             situation?, ruling?, explanation?, rules_cited?,
             flagged?, flag_reason? }
  - Upserts case record to Supabase cases table by case_id; sets ip_address
    from X-Forwarded-For (first hop) or req.ip (trust proxy enabled for Railway)
  - Returns: { success: true, id } (id = cases row id)

POST /share
  - Input: { case_id?, cards, category? (string or string[]), situation?, ruling, explanation, rules_cited }
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
  - Returns: { id, cards, category, situation, ruling, explanation, rules_cited, created_at }
  - 404 if not found

## Scryfall Integration
- Two calls per card: /cards/named?fuzzy= (oracle text) + /cards/{id}/rulings
- 100ms delay between requests to respect rate limits (max 10 req/sec)
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
  - Card search input with Scryfall autocomplete
  - Selected cards shown as lavender steel chips (removable)
  - Card image carousel (full width, swipeable, max 400px on desktop)
  - Most recently added card shown in carousel
  - Max 4 cards
  - "Request Verdict" button (enabled at 1+ cards)
  - Optional "Featured Rulings" section below action button (if available)

Step 2 — Select Context
  - Selected cards shown (removable)
  - Auto-fetches /categories on entry (1+ cards)
  - Category chips (multi-select; selected chips cinnamon buff / dark text)
  - Optional situation text input
  - Back (flex:1) + Get Verdict (flex:3) buttons

Step 3 — View Verdict
  - Ruling card: RULING in pistachio green, EXPLANATION as bullets, RULES CITED as tappable tags (native alert with full line)
  - Actions below divider:
    - Row 1: "Share this ruling" (full-width pistachio fill; Sharing… / ✓ Link copied!)
    - Row 2: "Present Another Case" (full-width outlined lavender steel)
    - Row 3: Back (flex:1) + "Appeal this ruling" (flex:3, etruscan red outline)
  - Flag flow: immediate `logCase` on tap → modal for optional reason → confirm

## Button Labels
- Step 1 proceed: "Request Verdict"
- Step 2 back: "Back"
- Step 2 confirm: "Get Verdict"
- Step 3 back (to context): "Back"
- Step 3 reset (new case from step 1): "Present Another Case"
- Step 3 share: "Share this ruling"
- Step 3 flag: "Appeal this ruling"

## Usage Logging (Supabase cases table)
Logged across the flow (same case_id, upserted):
1. On "Request Verdict" tap (Step 1) → cards only
2. On "Get Verdict" tap → cards + category + situation
3. On ruling received → full case including verdict
4. On flag → flagged: true + flag_reason

Each case uses a UUID case_id (upserted, not inserted) so partial
sessions appear as one row with null fields for incomplete steps.
session_id groups multiple cases from the same app session.
ip_address (text, nullable) stores the client IP for each upsert.
Images are never stored — only card names.

## Database (Supabase)
- **cases** — usage logging (see Usage Logging above); includes ip_address (add via backend/sql/add_cases_ip_address.sql if missing)
- **shared_rulings** — id (text PK), case_id (FK to cases), cards, category, situation, ruling, explanation, rules_cited, created_at

## Rate Limiting
- 120 requests per hour per IP address
- Applies to /categories, /ruling, /log, and /share endpoints
- Exception: GET /share/featured is read-only and not rate-limited
- 429 response shows friendly message in UI

## Colour Palette
- Background: #000000 (black)
- Surface: #111111 (dark charcoal)
- Border: #1e1e1e (subtle, near-invisible)
- Title accent (cinnamon buff): #c8a882
- Lavender steel: #7C6F9B
- Primary buttons (etruscan red): #9b2335
- Selected category chips (cinnamon buff): #c8a882
- Selected category chip text: #111111 (dark, for contrast on buff)
- Share primary button fill (pistachio green): #93c572
- Share primary button text: #111111
- RULING headline (pistachio green): #93c572
- Card chips border/text and carousel active dot (lavender steel): #7C6F9B
- Rules cited tags (cinnamon buff): #c8a882
- Small highlights (etruscan red): #9b2335
- Text: #f0f0f0
- Muted text: #a0a0a0
- Font: serif (title), sans-serif / Helvetica Neue on iOS (body)
- Palatino family used only in SVG logo

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
- Content padding: paddingHorizontal 16, paddingVertical 24
- Max content width: 600px centred on desktop

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
- constants/theme.ts — shared colours/fonts/error constant
- utils/scryfall.ts — shared `fetchCardImageUri` helper
- scripts/embed_rules.py — CR download, chunk (section-prefixed text), embed, upload
- scripts/mtg_judge_test.py — Python test suite for the ruling engine
- CLAUDE.md — this file

## Coding Conventions
- TypeScript throughout
- Functional components with hooks
- StyleSheet for all styles (no NativeWind)
- All async calls wrapped in try/catch with user-visible error states
- logCase always fires and forgets — never blocks UI
- Images never stored in Supabase — card names only
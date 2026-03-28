---
description: 
alwaysApply: true
---

# The Arbiter — Project Context

## App Name
The Arbiter

## What This App Is
An AI-powered Magic: The Gathering rules judge companion. Players input
cards involved in a dispute and the app generates an accurate, cited verdict.
Positioned as an at-the-table companion — not a life tracker or deckbuilder.

## Target User
Casual MTG players who encounter rules disputes during games.

## Tech Stack
- React Native with Expo (TypeScript)
- Backend: Express.js server (handles all API calls — keys never on device)
- LLM: Anthropic Claude (claude-sonnet-4-6) for rulings and category generation
- Embeddings: Voyage AI (voyage-3.5, 1024 dimensions)
- Vector DB: Supabase pgvector (comprehensive_rules table)
- Card data: Scryfall API (free, no auth, fuzzy name search + rulings endpoint)
- Analytics: Vercel Analytics

## Hosting
- Frontend: Vercel (https://the-arbiter-steel.vercel.app)
- Backend: Railway (https://the-arbiter-production.up.railway.app)
- Database: Supabase

## Architecture
All API keys live on the backend Express server. The React Native app
calls the backend only — never Anthropic, Voyage, or Supabase directly.

### Backend Endpoints
POST /categories
  - Input: { cards: string[] }
  - Fetches Scryfall oracle text + official WotC rulings per card
  - Calls Claude to generate 3-5 relevant interaction category labels
  - Returns: { categories: string[] }

POST /ruling
  - Input: { cards: string[], situation?: string, category?: string }
  - Fetches Scryfall oracle text + official WotC rulings per card
  - Embeds query with Voyage AI, retrieves top 5 CR chunks from Supabase
  - Calls Claude with retrieved CR context + oracle text + official rulings
  - Returns: { ruling, explanation, rules_cited, oracle_referenced }

POST /flag
  - Input: { cards, category?, situation?, ruling, explanation,
             rules_cited, reason? }
  - Appends flag record to flagged_rulings.jsonl
  - Returns: { success: true, id }

POST /log
  - Input: { session_id, case_id, cards, selected_category?,
             situation?, ruling?, explanation?, rules_cited?,
             flagged?, flag_reason? }
  - Upserts case record to Supabase cases table by case_id
  - Returns: { success: true }

## Scryfall Integration
- Two calls per card: /cards/named?fuzzy= (oracle text) + /cards/{id}/rulings
- 100ms delay between requests to respect rate limits (max 10 req/sec)
- image_uris.normal used for card images — falls back to card_faces for DFCs

## Two-Call Flow
1. Player adds 1+ cards → app auto-calls /categories → displays chips
2. Player optionally taps a chip and/or types a situation
3. Player taps "Get Verdict" → calls /ruling → displays result

## Hybrid Situation Approach
- Cards only → app deduces all relevant interactions (deduction mode)
- Cards + category chip → focused ruling on that interaction type
- Cards + typed situation → answers the specific question
- Cards + both → fully focused ruling

## Ruling Output Format
RULING: [one sentence]
EXPLANATION: [step by step]
RULES CITED: [rule numbers]
CARD ORACLE TEXT REFERENCED: [relevant card text]

## Three-Step UX Flow
Step 1 — Specify Cards
  - Card search input with Scryfall autocomplete
  - Selected cards shown as cinnamon buff chips (removable)
  - Card image carousel (full width, swipeable, max 400px on desktop)
  - Most recently added card shown in carousel
  - Max 6 cards
  - "Present your case" button (enabled at 1+ cards)

Step 2 — Select Context
  - Selected cards shown (removable)
  - Auto-fetches categories on entry
  - Category chips (single select, pistachio green when selected)
  - Optional situation text input
  - Back (flex:1) + Get Verdict (flex:3) buttons

Step 3 — View Verdict
  - Ruling card: RULING in pistachio green, EXPLANATION, RULES CITED tags
  - "Back" (flex:1) + "Next Case" (flex:3) buttons
  - "Appeal this ruling" flag button (etruscan red border, no fill)
  - Flag flow: immediate log on tap → modal for optional reason → confirm

## Button Labels
- Step 1 proceed: "Present your case"
- Step 2 back: "Back"
- Step 2 confirm: "Get Verdict"
- Step 3 back: "Back"
- Step 3 reset: "Next Case"
- Step 3 flag: "Appeal this ruling"

## Usage Logging (Supabase cases table)
Logged at three moments per case:
1. On "Present your case" tap → cards only
2. On "Get Verdict" tap → cards + category + situation
3. On ruling received → full case including verdict
4. On flag → flagged: true + flag_reason

Each case uses a UUID case_id (upserted, not inserted) so partial
sessions appear as one row with null fields for incomplete steps.
session_id groups multiple cases from the same app session.
Images are never stored — only card names.

## Rate Limiting
- 60 requests per hour per IP address
- Applies to /categories, /ruling, and /log endpoints
- 429 response shows friendly message in UI

## Colour Palette
- Background: #000000 (black)
- Surface: #111111 (dark charcoal)
- Border: #1e1e1e (subtle, near-invisible)
- Title accent (cinnamon buff): #c8a882
- Primary buttons (etruscan red): #9b2335
- Selected chips (pistachio green): #93c572
- Selected chip text: #111111 (dark, for contrast on green)
- RULING headline (pistachio green): #93c572
- Card name chips (cinnamon buff): #c8a882
- Rules cited tags (cinnamon buff): #c8a882
- Small highlights (etruscan red): #9b2335
- Text: #f0f0f0
- Muted text: #a0a0a0
- Font: serif (title), sans-serif / Helvetica Neue on iOS (body)
- Palatino family used only in SVG logo

## Logo
- SVG text logo: "ARBITER" in all caps
- Font: Palatino Linotype / Palatino / serif
- Gold gradient: #c8a882 → #e8c9a0 → #c8a882 → #9a7a58
- Centred, letter-spacing 12, no decorative elements
- File: assets/arbiter_logo.svg

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
- app/+html.tsx — web HTML wrapper (viewport, overscroll, analytics)
- app/_layout.tsx — Expo Router layout (headerShown: false)
- backend/server.js — Express backend (all API endpoints)
- backend/flagged_rulings.jsonl — flagged ruling log
- scripts/embed_rules.py — one-time CR embedding script
- scripts/mtg_judge_test.py — Python test suite for the ruling engine
- CLAUDE.md — this file

## Coding Conventions
- TypeScript throughout
- Functional components with hooks
- StyleSheet for all styles (no NativeWind)
- All async calls wrapped in try/catch with user-visible error states
- logCase always fires and forgets — never blocks UI
- Images never stored in Supabase — card names only
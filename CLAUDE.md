---
description: 
alwaysApply: true
---

# MTG AI Judge — Project Context

## App Name
The Arbiter

## What This App Is
An AI-powered Magic: The Gathering rules judge companion. Players input 
cards involved in a dispute and the app generates an accurate, cited ruling.
Positioned as an at-the-table companion — not a life tracker or deckbuilder.

## Target User
Commander and casual MTG players who encounter rules disputes during games.

## Tech Stack
- React Native with Expo (TypeScript)
- Backend: Express.js server (handles all API calls — keys never on device)
- LLM: Anthropic Claude (claude-sonnet-4-6) for rulings and category generation
- Embeddings: Voyage AI (voyage-3.5, 1024 dimensions)
- Vector DB: Supabase pgvector (comprehensive_rules table)
- Card data: Scryfall API (free, no auth, fuzzy name search)

## Architecture
All API keys live on the backend Express server. The React Native app
calls the backend only — never Anthropic, Voyage, or Supabase directly.

### Backend Endpoints
POST /categories
  - Input: { cards: string[] }
  - Fetches Scryfall oracle text for each card
  - Calls Claude to generate 3-5 relevant interaction category labels
  - Returns: { categories: string[] }

POST /ruling
  - Input: { cards: string[], situation?: string, category?: string }
  - Fetches Scryfall oracle text
  - Embeds query with Voyage AI, retrieves top 5 CR chunks from Supabase
  - Calls Claude with retrieved context + oracle text
  - Returns: { ruling: string, explanation: string, rules_cited: string[] }

## Two-Call Flow
1. Player adds 2+ cards → app auto-calls /categories → displays chips
2. Player optionally taps a chip and/or types a situation
3. Player taps "Get Ruling" → calls /ruling → displays result

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

## UI Requirements
- Dark theme (players use this in low-light table conditions)
- High contrast text, large tap targets
- Minimal friction — optimised for quick lookup during an active game

## Roadmap Phases
Phase 1 (current): AI Judge MVP — card search, ruling display, citations
Phase 2: Camera OCR card capture, web search augmentation, flag ruling
Phase 3: Life tracker, turn timer, wishlist with pricing
Phase 4: Community rulings, upvote/dispute, reputation system

## Key Files
- mtg_judge_test.py — Python test suite for the ruling engine
- embed_rules.py — One-time script to embed CR into Supabase
- CLAUDE.md — This file

## Coding Conventions
- TypeScript throughout
- Functional components with hooks
- NativeWind for styling (Tailwind classes in React Native)
- All async calls wrapped in try/catch with user-visible error states

## Colour Palette
- Background: #000000 (black)
- Surface: #111111 (dark charcoal)
- Border: #1e1e1e (subtle, near-invisible)
- Title accent (cinnamon buff): #c8a882
- Primary buttons (etruscan red): #9b2335
- Selected chips (pistachio green): #93c572
- RULING headline (pistachio green): #93c572
- Card name chips (cinnamon buff): #c8a882
- Rules cited tags (cinnamon buff): #c8a882
- Small highlights (etruscan red): #9b2335
- Text: #f0f0f0
- Muted text: #a0a0a0
- Font: Helvetica Neue (iOS) / sans-serif (Android)
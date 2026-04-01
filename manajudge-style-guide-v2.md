# ManaJudge — UI Style Guide v2
**Version:** 2.0  
**Purpose:** Hand this file to Claude and ask it to generate Cursor prompts for implementing the redesign in the existing React Native / Expo codebase.

---

## Context

ManaJudge is an AI-powered Magic: The Gathering rules judge app. Stack: React Native + Expo (TypeScript) on the frontend, Express.js backend, deployed on Vercel (manajudge.com). The primary UI file is `app/index.tsx`, with shared ruling page at `app/ruling/[id].tsx` and theme constants in `constants/theme.ts`.

The redesign covers all three steps of the core flow plus global chrome (header, nav, buttons, inputs). The goal is a polished, MTG-themed UI where the **ruling verdict** is the undisputed visual centrepiece — it's the single most valuable output for users, and the design must make that unmistakable.

---

## Design Philosophy

| Principle | Rule |
|-----------|------|
| Cinnamon buff is the **identity colour** | It carries the brand. Used for the RULING wrapper border, verdict text, logo, selected category chip fills, outline buttons (e.g. “Request another Verdict”), and focus rings. It should feel warm, authoritative, and ever-present. |
| Etruscan red is the **support colour** | Emphasis and urgency. Used for the **“RULING”** section label, primary CTAs, flag/appeal actions, card-chip remove marks, error text, and emphasis keywords in explanation text. Never for large background fills beyond buttons. |
| The ruling is the **hero** | Step 3's **RULING wrapper** must carry the highest visual weight on screen — warm `COLOURS.bgAccent` fill, `COLOURS.brand` border (2px), typographically distinct verdict. EXPLANATION and RULES CITED stay in standard section wrappers so hierarchy remains clear. |
| Always dark | Black background (`COLOURS.background`) with charcoal surfaces (`COLOURS.surface`). Players use this in low-light table conditions. |
| Muted green is **confirmation only** | Reserved for the share button fill and flag success confirmation. Nowhere else. |
| Card chips stay **neutral** | Card name chips use `--text-secondary` and `--border-subtle` borders only — no purple/lavender accent. Carousel inactive dots use `--border-chip`; active dot uses `COLOURS.brandSoft`. |

---

## Design Tokens

### Colour primitives

Clean palette — no lavender steel, no `bgSecondary`, no `redDeep`. **Implement with `COLOURS.*` in code** (`constants/theme.ts`). Optional design-doc aliases in parentheses.

| `COLOURS` key | Hex | Role (alias) |
|---------------|-----|----------------|
| `background` | `#000000` | App background (`--bg-primary`) |
| `surface` | `#111111` | Cards, inputs, containers (`--bg-surface`) |
| `bgAccent` | `#1A1611` | Warm fill: ruling wrapper, rules cited tags |
| `brand` | `#c8a882` | Cinnamon buff — identity (alias `--gold-primary`) |
| `brandSoft` | `#DFC4A8` | Verdict hero text, carousel accents (alias `--gold-soft`) |
| `brandDim` | `#8C6E50` | Rules cited tag chrome on `bgAccent` (alias `--gold-dim`) |
| `action` | `#9b2335` | Etruscan red — CTAs, RULING label, appeal (alias `--red-primary`) |
| `confirm` | `#4FAF7A` | Share + flag success only (alias `--green-primary`) |
| `text` | `#f0f0f0` | Primary copy (`--text-primary`) |
| `textSecondary` | `#A0A6B0` | Card names, secondary (`--text-secondary`) |
| `textMuted` | `#6F7682` | Section caps, muted UI (`--text-muted`) |
| `border` | `#1e1e1e` | Default borders, card chips (`--border-subtle`) |
| `chipBorder` | `#2a2a2a` | Category chips unselected, dot inactive (`--border-chip`) |
| `placeholder` | `#3a3a3a` | Input placeholder |
| — | `#111111` | Text on `brand` / `confirm` fills — use `surface` (inverse on buff) |

### `constants/theme.ts` (authoritative)

```typescript
export const COLOURS = {
  background:     '#000000',
  surface:        '#111111',
  bgAccent:       '#1A1611',

  brand:          '#c8a882',
  brandSoft:      '#DFC4A8',
  brandDim:       '#8C6E50',

  action:         '#9b2335',
  confirm:        '#4FAF7A',

  text:           '#f0f0f0',
  textSecondary:  '#A0A6B0',
  textMuted:      '#6F7682',

  border:         '#1e1e1e',
  chipBorder:     '#2a2a2a',

  placeholder:    '#3a3a3a',
} as const;
```

---

## Key Redesign: The Ruling as Hero

The ruling verdict is currently muted green (`#4FAF7A`), the same colour as the share button. This dilutes both elements. In the redesign:

1. **Ruling verdict text** → `COLOURS.brandSoft` (`#DFC4A8`) in a serif font (Cinzel or Georgia), larger size (18–19px), high line-height. This makes it feel authoritative and distinct from all other text.
2. **RULING wrapper** gets a **2px** `COLOURS.brand` border (border-radius 12px) and **`COLOURS.bgAccent`** (`#1A1611`) fill — warm, elevated, unmistakable. It should be the only emphasized wrapper in Step 3.
3. **"RULING" section label** → **`COLOURS.action`** (`#9b2335`) so the label reads as urgency/authority and stays separate from the cinnamon verdict line.
4. **Explanation body** → sans-serif font at 14px. Emphasis keywords in **`COLOURS.action`** italic.
5. **Rules cited tags** → `COLOURS.brandDim` border + text on **`COLOURS.bgAccent`** fill — same warm chip treatment as the ruling block family.
6. **Share button** keeps `COLOURS.confirm` (pistachio) — the only green element, clearly a distinct action rather than part of the ruling's visual identity.

---

## Typography

| Use | Family | Size | Weight | Colour |
|-----|--------|------|--------|--------|
| Logo | PNG asset (`manajudge_title.png`) | — | — | Cinnamon buff gradient |
| Tagline | serif | 14px | 400 | `--text-secondary` |
| Ruling verdict | serif (Georgia on web; ui-serif on iOS) | 18px | 700 | `COLOURS.brandSoft` |
| Step labels | sans-serif | 10px | 700 | `--text-secondary`, letter-spacing 3, uppercase |
| Section labels (EXPLANATION, RULES CITED) | sans-serif | 10px | 600 | `--text-muted`, letter-spacing 3, uppercase |
| Section label **RULING** | sans-serif | 10px | 600 | **`COLOURS.action`**, letter-spacing 3, uppercase |
| Explanation body | Helvetica Neue (iOS) / sans-serif | 14px | 400 | `--text-primary`, line-height 22 |
| Emphasis keywords | Same as explanation | 14px | 400 italic | **`COLOURS.action`** |
| Rule numbers/tags | sans-serif | 12px | 600 | **`COLOURS.brandDim`** border + text on `COLOURS.bgAccent` |
| Button labels | sans-serif | 16px | 700 (primary) / 400 (tertiary) | Per button token |
| Body / UI chrome | sans-serif | 14–16px | 400 | `--text-secondary` |
| Helper/hint text | serif | 14px | 400 | `--text-secondary` |

**Font constants** (from `constants/theme.ts`):
```typescript
export const TITLE_FONT = 'serif';
export const BODY_FONT = 'sans-serif';
```

---

## Layout & Spacing

- Max content width: **600px**, centred
- Horizontal padding: **16px**
- Vertical padding: **24px**
- Button height: always **fixed** — use `height: 52` (primary/secondary) or `minHeight: 44` (tertiary), not padding-based
- Border radius: **10–12px** standard, **20px** for chips and pills, **6px** for rule tags
- Gap between action buttons: **8px**
- Section spacing: **20px** `marginBottom` + **20px** `paddingBottom` between major blocks
- Input font size: **16px** minimum (prevents auto-zoom on mobile)

---

## Component Specs

### RULING Wrapper (Step 3 — Signature Component)
```
Background:   COLOURS.bgAccent (#1A1611)   /* warm-tinted fill */
Border:       2px solid COLOURS.brand (#c8a882), border-radius 12px
```
- **"RULING" label**: **`COLOURS.action`** (#9b2335), 10px, uppercase, letter-spacing 3
- **Verdict text**: serif, 18–19px, weight 700, `COLOURS.brandSoft` (#DFC4A8), line-height ~1.35

### Step 3 Standard Content Sections
- **EXPLANATION wrapper**: standard `styles.section` treatment (no hero border/elevation)
- **"EXPLANATION" label**: `--text-muted`, same styling as other section labels
- **Explanation bullets**: `--text-primary`, 14px, sans-serif, line-height 22. Emphasis keywords in **`COLOURS.action`** italic.
- **RULES CITED wrapper**: standard `styles.section` treatment (no hero border/elevation)
- **"RULES CITED" label**: `--text-muted`
- **Rule tags**: **`COLOURS.brandDim`** border + text, **`COLOURS.bgAccent`** fill, 12px, border-radius 6px, tappable (shows full rule in Alert)

### Category Chips (Step 2)
```
/* Default */
Background:   --bg-surface
Border:       --border-chip (#2a2a2a)
Text:         --text-secondary

/* Selected */
Background:   COLOURS.brand (#c8a882)
Border:       COLOURS.brand
Text:         --text-inverse / --bg-surface (#111111), weight 700   /* dark on cinnamon fill */
```

### Card Name Chips
```
Background:   --bg-surface (#111111)
Border:       --border-subtle (#1e1e1e)   /* no lavender, no COLOURS.brandDim on card chips */
Text:         --text-secondary (#A0A6B0), weight 500
Remove mark:  COLOURS.action (#9b2335)
```

### Buttons

| Button | Background | Border | Text | Height |
|--------|-----------|--------|------|--------|
| **Primary CTA** ("Request Verdict") | **`COLOURS.action`** (#9b2335) | none | `--text-primary`, 700 | 52px |
| **Step 2 Get Verdict** | **`COLOURS.action`** | none | `--text-primary`, 700 | 52px |
| **Step 2 Back** | `--bg-surface` | `--border-subtle` | `--text-secondary` | 52px |
| **Share this ruling** | `COLOURS.confirm` | `COLOURS.confirm` | `--text-inverse`, 700 | 52px |
| **Request another Verdict** | transparent | **`COLOURS.brand`** | **`COLOURS.brand`**, 700 | 52px |
| **Appeal this ruling** | transparent | `COLOURS.action` | `COLOURS.action`, 700 | 52px |
| **Back (Step 3)** | `--bg-surface` | `--border-subtle` | `--text-secondary` | 52px |
| **Refine (Present new evidence)** | `COLOURS.action` (enabled) / `--bg-surface` (disabled) | matching | `--text-primary` / `--placeholder` | 44px min |

### Input Fields
```
Background:     --bg-surface
Border:         --border-subtle
Focus border:   COLOURS.brand  (not currently implemented — target for redesign)
Text:           --text-primary
Placeholder:    --placeholder (#3a3a3a)
Font size:      16px (prevents mobile auto-zoom)
Border radius:  12px
```

### Step Progress
Currently implicit via step labels ("Step 1:", "Step 2:", "Step 3:") rather than a visual progress bar. Step labels use `--text-secondary`, 10px uppercase with letter-spacing 3.

### Featured Rulings (Step 1)
```
Card background:  --bg-surface
Card border:      --border-subtle
Title text:       COLOURS.brand, 14px, weight 600
Preview text:     --text-secondary, 14px
```

### Carousel (Step 1)
```
Arrow background: rgba(0,0,0,0.6), border-radius 20
Arrow text:       COLOURS.brandSoft
Dot inactive:     --border-chip
Dot active:       COLOURS.brandSoft
```

---

## Screen-by-Screen Spec

### Global Chrome
- Full-screen `--bg-primary` background
- Logo: `manajudge_title.png` (100% width, 60px height, centred)
- Tagline below logo: "Pre-Stack Clarity for Magic: The Gathering" (serif, 14px, `--text-secondary`, centred)
- Divider below tagline: 1px `--border-subtle`

### Step 1 — Specify Cards
- **Step label**: "Step 1: Specify cards"
- **Search input**: full width, placeholder "Search for a card..."
- **Helper text**: "Add at least 1 card to continue." (serif, 14px, `--text-secondary`). When at max: "4 cards maximum — remove one to add another"
- **Autocomplete dropdown**: `--bg-surface` with `--border-subtle` border, rows at minHeight 44
- **Card chips**: `COLOURS.border` (subtle), `COLOURS.textSecondary` names; removable (× in `COLOURS.action`)
- **Card image carousel**: swipeable, aspect ratio 63:88, max 400px on web
- **Primary CTA**: "Request Verdict" — **`COLOURS.action`** fill, full width, 52px
- **Featured Rulings section** (below CTA, optional): section label "Featured Rulings", card list with `COLOURS.brand` titles

### Step 2 — Select Interaction
- **Section label**: "Selected cards" — with removable card chips
- **Step label**: "Step 2: Select interaction and/or describe situation"
- **Category chips**: 3–5 AI-generated, multi-select. Loading state shows spinner + "Finding likely interactions…"
- **Situation textarea**: placeholder "Describe the situation (optional)...", min-height 100
- **Action row**: "Back" (flex 1, tertiary) + "Get Verdict" (flex 3, `COLOURS.action`). Loading: spinner + "Jury deliberating…"

### Step 3 — Verdict *(Hero Screen)*
- **Section label**: "Selected cards" — card chips tappable to show full image in modal
- **RULING section** (signature wrapper — highest visual weight):
  - Step label: "Step 3: Verdict"
  - **`COLOURS.bgAccent`** fill, **`COLOURS.brand` 2px** border, border-radius 12px
  - "RULING" label in **`COLOURS.action`**
  - Verdict text: serif, 18–19px, `COLOURS.brandSoft`, bold
- **EXPLANATION + RULES CITED section** (standard wrapper):
  - "EXPLANATION" label in `--text-muted`
  - Bullet-pointed explanation in `--text-primary`
  - "RULES CITED" label in `--text-muted`
  - Rule tags: tappable, `COLOURS.brandDim` on `COLOURS.bgAccent`
- **Divider**
- **Action stack** (8px gap between buttons):
  - "Share this ruling" — full width, `COLOURS.confirm` fill, 52px
  - "Request another Verdict" — full width, transparent fill, **`COLOURS.brand`** border and text, 52px
  - Row: "Back" (flex 1, tertiary) + "Appeal this ruling" (flex 3, `COLOURS.action` outlined)
- **Flag confirmation**: "✓ Verdict flagged. Thank you." in `COLOURS.confirm`
- **Appeal modal**: `--bg-surface` card on dark overlay, textarea + "Skip" / "Submit" buttons

### Shared Ruling Page (`/ruling/[id]`)
- Same logo + tagline as main app
- Single result card (`--bg-surface`, `--border-subtle` border, border-radius 14)
- Same RULING / EXPLANATION / RULES CITED structure as Step 3: RULING block uses **`COLOURS.bgAccent`** + **`COLOURS.brand`** border; **“RULING”** label **`COLOURS.action`**; verdict `COLOURS.brandSoft`; rule tags `COLOURS.brandDim` on `COLOURS.bgAccent`
- Card chips: `COLOURS.border`, `COLOURS.textSecondary` (no lavender)
- Card chips tappable for image popup
- Category chips read-only, selected style: `COLOURS.brand` fill + dark (`--bg-surface`) text
- CR version label at bottom right
- "Ask ManaJudge" / primary CTA: **`COLOURS.action`** fill at bottom

---

## Colour Usage Rules (Enforcement)

These are hard constraints — apply them as linting rules when reviewing generated code:

1. **Cinnamon buff** (`COLOURS.brand` / `COLOURS.brandSoft` / `COLOURS.brandDim`) is the identity colour. It appears on: RULING wrapper **border**, ruling verdict text (`COLOURS.brandSoft`), logo, **selected category chip fills**, **“Request another Verdict”** outline (border + label), featured ruling titles, carousel arrow labels + active dot, share/outline treatments, input focus borders (target). It is **not** used for the **“RULING”** section label — that label uses `COLOURS.action` (see rule 2).
2. **Etruscan red** (`COLOURS.action`, `#9b2335`) is the support colour. It appears on: **“RULING”** section label, primary CTA fills (“Request Verdict”, “Get Verdict”, “Submit”), Appeal button border/text, card chip remove marks, error text, emphasis keywords in explanation (italic). Never for large background fills beyond buttons.
3. **Muted green** (`COLOURS.confirm`, pistachio) appears only on: the Share button fill and flag success confirmation text. Nowhere else. Specifically, it is **not** used for ruling text.
4. **Backgrounds** are always dark (`COLOURS.background`, `COLOURS.surface`, `COLOURS.bgAccent` only). No light surfaces.
5. **No lavender steel** (or any purple accent) for card chips, borders, or carousel — use `COLOURS.border`, `COLOURS.chipBorder`, and `COLOURS.textSecondary` only for that chrome (aliases: `--border-subtle`, `--border-chip`, `--text-secondary`).
6. **Button heights** are fixed values (`height: 52` or `minHeight: 44`), not padding-derived.
7. **No counter pill** on the card search input — show inline helper text instead.
8. **Fonts**: serif for ruling verdict and tagline. Sans-serif for all other UI chrome.

---

## Migration Summary (Current → Redesign)

| Element | Current | Redesign |
|---------|---------|----------|
| Ruling verdict text colour | `#4FAF7A` (muted green) | `#DFC4A8` (`COLOURS.brandSoft`) — cinnamon buff family |
| Ruling verdict font | sans-serif, 16px | serif, 18–19px |
| Step 3 RULING wrapper fill | flat surface | `#1A1611` (`COLOURS.bgAccent`) — warm tint |
| Step 3 RULING wrapper border | none / thin | **2px** `#c8a882` (`COLOURS.brand`), border-radius 12px |
| "RULING" section label colour | muted / gold | **`#9b2335`** (`COLOURS.action`, etruscan red) |
| Card name chip border | lavender / brandDim | `#1e1e1e` (`COLOURS.border`) only |
| Category chip selected | mixed | `#c8a882` (`COLOURS.brand`) fill + `#111111` text (`COLOURS.surface`) |
| Input focus border | `#1e1e1e` (same as default) | `#c8a882` (`COLOURS.brand`) — target |
| Share button | `#4FAF7A` fill | unchanged (`COLOURS.confirm`) — the **only** green element |

Palette cleanup: no lavender steel, no legacy `bgSecondary` / `redDeep` tokens; implementation uses semantic keys in `constants/theme.ts` (`brand`, `action`, `confirm`, etc.).
# me.md Design System — "Modern Editorial"

The canonical token sheet for the me.md identity, chosen 2026-07-04 from the Phase 1 direction mockups (`.design/mockups/variant-b-editorial.html`, local-only). Phase 2 encodes these as CSS custom properties + Tailwind theme. This file is the source of truth; mockups are throwaway.

**Feel:** a beautifully art-directed magazine feature about your own life. Confident, contemporary, warm. Typography and hairline rules carry the hierarchy — never boxes, shadows, or colored pills.

## Color

### Light theme ("paper")

| Token | Value | Role |
| --- | --- | --- |
| `bg` | `#FBF9F4` | Page background (warm white) |
| `ink` | `#1E1912` | Primary text |
| `ink-70` | `rgba(30,25,18,.70)` | Secondary text |
| `ink-55` | `rgba(30,25,18,.55)` | Tertiary / meta text |
| `ink-40` | `rgba(30,25,18,.40)` | Placeholders, disabled, quiet markers |
| `accent` | `#C77B21` | The amber — links, active states, verified marks, primary actions. The only saturated color |
| `accent-dim` | `rgba(199,123,33,.35)` | Accent underlines/washes |
| `rule` | `#E7DFD0` | Hairline rules and borders (1px, everywhere borders are needed) |
| `panel` | `#F4EDDF` | Paper-tint raised panels (pull-quotes, hovers, active nav) |

### Dark theme ("lamplight") — final values from `session-b-dark.html`

| Token | Value | Contrast on `bg` | Role |
| --- | --- | --- | --- |
| `bg` | `#17130D` | — | Deep warm charcoal-brown, never slate |
| `ink` | `#EFE9DE` | ~15:1 | Warm off-white primary text |
| `ink-muted` | `#A89F8F` | ~7:1 | Secondary/small-caps chrome |
| `ink-faint` | `#7A7264` | ~3.9:1 | Decorative only (placeholders, dot outlines) — never body text |
| `accent` | `#E09A3E` | ~8.5:1 (~7.8:1 on panel) | Amber brightened; passes AA/AAA for its uses |
| `rule` | `#3A3226` | — | Hairlines |
| `panel` | `#241D14` | — | Raised warm surfaces; the pull-quote panel gets a soft warm radial glow (`rgba(224,154,62,.13/.05)`) |

Selection highlight is a warm amber tint (never default blue); depth comes from surface steps, not glows.

### Status semantics

Status is shown **typographically** (small caps + the accent or muting), not with green/red pills:
- **Verified** — amber check glyph + small-caps `VERIFIED` + confidence percentage.
- **Pending** — quiet small-caps `AWAITING REVIEW` in `ink-55`.
- **Rejected** — struck-through, `ink-40`.
- Destructive actions use ink-on-rule buttons that turn accent on hover; no dedicated red except in confirmations.

## Typography

| Face | Loading | Role |
| --- | --- | --- |
| **Newsreader** (incl. italic, optical sizes) | self-hosted woff2 (Phase 2) | Display (topic titles — large italic), transcript/notes prose, pull-quotes, serif moments (placeholders, greetings) |
| **Public Sans** | self-hosted woff2 | UI chrome: nav, small-caps labels, meta lines, chips, buttons |
| JetBrains Mono | self-hosted woff2 | Code/JSON surfaces (finally actually loaded) |

Conventions:
- **Small caps everywhere chrome speaks**: nav items, section headings (`SESSIONS`, `RELATED INSIGHTS`), speaker labels, metadata — Public Sans, ~11-12px, `letter-spacing: .08em`, uppercase.
- **Display**: Newsreader italic, 40-56px for page titles; kicker line above in small-caps amber.
- **Prose/reading**: Newsreader 17-18px, line-height ≥1.65, measure ~65ch.
- **Numbered exchanges**: transcript/list markers as quiet two-digit numerals (`01`, `02`) in `ink-40`.

## Shape & depth

- Hairline rules (`1px rule`) replace card borders; sections separate by rule + whitespace, not boxes.
- Radii: small (4-6px) on chips/inputs; the send button is the one circular element.
- Shadows: effectively none in light theme; dark theme uses surface steps, not glows.
- Progress: thin amber hairline fills, not bars.
- Bookmarked content: amber underline inline + reappears as a Newsreader italic pull-quote on a `panel` surface with an amber left rule.

## Signature moves (carry through every screen)

1. The **pull-quote** treatment for bookmarked/highlighted user words.
2. **Numbered editorial markers** for sequences (transcript exchanges, review queue items).
3. **Small-caps + hairline** section headers.
4. The **single amber accent** discipline — if two things compete for amber on one screen, one of them is wrong.
5. Serif italic for anything "in the user's voice" or inviting reflection (placeholders like *Take your time…*).

## Accessibility

- All text token pairs must pass WCAG AA in both themes (amber on paper is for large text/small-caps emphasis only; body text is always ink).
- Focus-visible: 2px accent outline (replaces the current indigo `#6366f1`).
- Reduced motion respected; hairline progress and hovers animate ≤150ms.

## Reference mockups (local, gitignored)

- `.design/mockups/variant-b-editorial.html` — interview session (canonical)
- `.design/mockups/desk-b.html` — dashboard/Desk
- `.design/mockups/topic-b.html` — topic detail
- `.design/mockups/session-b-dark.html` — dark theme reference

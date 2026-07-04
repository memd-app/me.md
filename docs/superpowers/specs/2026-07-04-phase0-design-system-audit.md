# Phase 0 Design-System Audit — me.md client

Read-only audit of `client/` (React 18 + Vite 5 + Tailwind 3.4.13, no Tailwind plugins). Feeds Phase 2 of `2026-07-04-design-revamp-design.md`.

## a) Component kit gap list

| New `ui/` component | Replaces | Usage evidence |
|---|---|---|
| `Button` (primary/secondary/danger) | `.btn-primary`/`.btn-secondary` (`src/styles/index.css:73-95`); `.btn-danger` (`index.css:97-101`, **0 usages — dead**); dozens of inline one-off buttons (`ConflictsSection.tsx:257-273,474-497`, ErrorBoundary, etc.) | btn-primary: 44 uses; btn-secondary: 20 |
| `Card` | `.card` (`index.css:103-111`) **plus** ≥4 competing hand-rolled variants: shadowed (`ImportPage.tsx:407,453,542,587,645`, `OnboardingPage.tsx:555,565`), shadowless dark-surface (`NotesPage.tsx:277,328,344`), gray-900 (`KnowledgeGraphPage.tsx:807`), Modal's own panel (`Modal.tsx:106`) | `.card`: ~85 uses; ad-hoc bypasses: 42 |
| `Badge`/`Pill` | `badge-verified/pending/rejected` classes (`index.css:132-160`, **0 usages — dead**); `VerifiedBadge.tsx` (4 uses); ~20 inline pill patterns (`ConflictsSection.tsx:180-208`, `Sidebar.tsx:144`) | — |
| `Modal` | `common/Modal.tsx` is solid (focus trap, Esc, a11y) but adopted by only 2 pages (`TopicDetailPage.tsx:652`, `ExportPage.tsx:389`); duplicated from scratch in `SessionPage.tsx:1519` and `OnboardingPage.tsx:1211` | migrate the 2 hand-rolled overlays |
| `Input`/`Textarea`/`Select` | `.input-field` (`index.css:113-130`, 28 uses) + raw inputs with copied focus-ring strings (`ConflictsSection.tsx:450,462-468` etc.) | — |
| `Spinner` | `common/LoadingSpinner.tsx` — unified, re-skin only | 10 adopters |
| `ApiErrorAlert` | unified, re-skin only | 13 adopters |
| `EmptyState` | none shared — every page hand-builds one | 15 page files |
| `Prose`/reading surface | Two divergent markdown-lite renderers: `SessionPage.tsx:1029-1088` and `NotesPage.tsx:105-164`. NotesPage wraps output in `prose dark:prose-invert` — **inert: @tailwindcss/typography is not installed** (plugins `[]`, not in package.json) | converge on one component |
| `SwipeableCard` | keep, re-skin hardcoded green/red | 1 adopter (VerificationPage) |
| Layout shell (`AppLayout`/`Sidebar`) | structurally solid (skip-link, focus trap, aria); token swap only | app-wide |
| `ErrorBoundary` | solid; re-skin `bg-blue-600`/`bg-gray-200` buttons (`ErrorBoundary.tsx:64,72`) | app root |

## b) Token migration map

- **`primary` (indigo 50–950, `tailwind.config.js:10-25`)** → terracotta scale. Highest blast radius: **~230 raw `primary-*` occurrences** across every page (heaviest: OnboardingPage 13× `primary-600`; SessionPage 12× each of 400/500/600).
- **`verified`/`pending`/`rejected` tokens (`tailwind.config.js:26-28`)** → **dead, 0 usages**. Pages use ad-hoc `green/amber/red-100↔800` pairs instead (`VerifiedBadge.tsx:22-46`, ConflictsSection). Introduce real `success/warning/danger/info` tokens; delete or rewire the dead trio.
- **`dark.bg/surface/card/border` (`tailwind.config.js:29-35`, slate hexes)** → warm-dark equivalents, but **consolidate first**: the same visual role is expressed 5 ways — `dark:bg-dark-surface` (8×), `dark:bg-dark-card` (8×, OnboardingPage only), raw `dark:bg-gray-700` (~65×), `gray-800` (~70×), `gray-900` (~10×). A token-value swap won't reach the raw grays; needs a find/replace or codemod pass.
- **`fontFamily.sans: Inter`** (`tailwind.config.js:38`) → serif display + reading serif/humanist sans per identity. `fontFamily.mono` (JetBrains Mono) is declared but **never loaded** — mono text (13 uses) renders in system monospace today.
- **`safelist` (`tailwind.config.js:55-72`)** — 14 force-generated `dark:bg-dark-*` strings ("fast-glob may fail on paths with special characters"). New dark tokens need matching safelist entries, or root-cause the glob issue.
- `lineHeight.relaxed`, `slide-in` animation — keep as-is.

## c) Dark-mode assessment

- Mechanism: `darkMode: 'class'` + `ThemeContext.tsx:14-19` toggling `document.documentElement`, persisted to `localStorage['memd_theme']` + DB preference. **No rework needed** — warm-dark is a value swap through the same system.
- Coverage broad; no page missing dark variants wholesale (bg-white-without-dark hits are intentional: `LandingPage.tsx:335,369` hero, toggle knobs `SettingsPage.tsx:195`, `VerificationPage.tsx:645`).
- Real problem is **fragmentation** (5 values for one surface role, above), not gaps.
- `index.css:88-160` has 5 raw `.dark .btn-secondary`-style blocks with hex literals instead of `dark:` utilities — fold into tokens when redefining.

## d) D3 knowledge-graph restyle — difficulty: moderate

Named color maps (single-location, easy):
- `CATEGORY_COLORS` :67-74, `CATEGORY_COLORS_DIM` :77-84, `PERSONALITY_DOMAIN_COLORS` :87-93, `PERSONALITY_FACET_COLORS` :97-103, `STATUS_COLORS` :106-111 (all `KnowledgeGraphPage.tsx`).

Stray literals (the real work, ~12 sites):
- `getEdgeColor()` switch, 6 inline hexes :144-151; `getNodeColor()` concept-state hexes `#10b981`/`#a78bfa` :127-130; white strokes/labels baked into D3 `.attr()` at :403,411,449,511-512,522,570,580 (**needs theme-aware replacement — `#fff` won't read on cream**); gap-node `#fcd34d` :1028; legend swatches `#ec4899`/`#f9a8d4` :1037,1043; duplicated verified-green at :511,559,569.

`getNodeRadius()` :134-141 is score-driven — leave alone. `pentagonPath`/`diamondPath` :384,394 pure geometry. **Recommendation:** pull all colors into one palette object during the slice.

## e) Global CSS — redefine vs delete (`src/styles/index.css`)

| Class | Verdict |
|---|---|
| `.btn-primary` :73-78 | Redefine (44×) |
| `.btn-secondary` :80-95 | Redefine; fold `.dark` hex block into tokens |
| `.btn-danger` :97-101 | **Delete** (0 uses) |
| `.card` :103-111 | Redefine + migrate the 42 ad-hoc bypasses onto it |
| `.input-field` :113-130 | Redefine; fold `.dark` block |
| `.badge-*` :132-160 | **Delete** (0 uses); build new `Badge` |
| `.sr-only` :163-173 | Keep |
| `.skip-to-content` :176-198 | Redefine colors only (hardcoded `#4f46e5`) |
| focus-visible rules :35-69 | Redefine color only (`#6366f1`/`#818cf8` → new accent) |
| `body` base :10-17 | Redefine (incl. `.dark body { #0f172a }` hex) |
| `h1-h6` base :19-33 | Redefine structurally — where the serif display type lands |

## f) Typography & fonts

- `index.html:12-14` loads **Inter only** from Google Fonts. No serif anywhere today — the editorial serif is net-new.
- JetBrains Mono declared but never loaded (fix regardless).
- Reading surfaces needing the new Prose component: `SessionPage.tsx:1029-1088`, `NotesPage.tsx:105-164` (two divergent renderers). If leaning on `@tailwindcss/typography`, it must be **added as a dependency** — currently not installed despite `prose` classes in NotesPage.

## g) CSP change for self-hosted fonts

Current (`index.html:8-9`): `style-src` allows `fonts.googleapis.com`, `font-src` allows `fonts.gstatic.com`.
After self-hosting: `style-src 'self' 'unsafe-inline'`; `font-src 'self'` (or drop — falls back to default-src). Delete the two preconnects and the stylesheet link (`index.html:12-14`); add local `@font-face`/Vite-bundled fonts. No other directive changes.

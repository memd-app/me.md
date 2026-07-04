# me.md Design Revamp — Design Spec

**Date:** 2026-07-04
**Scope decisions (confirmed with owner):** revamp both surfaces, app first; warm-editorial identity; full redesign (IA + layouts + every screen); HTML-mockups-first workflow; approach B (design-system-first, screen-by-screen migration).

## 1. Goal

Replace the current generic Tailwind house style with a distinctive **warm editorial** identity — the app should feel like a private memoir/journal you're building with an interviewer, not a SaaS dashboard. At the same time, consolidate the information architecture: 23 pages accreted feature-by-feature and overlap heavily. The end state is a fully redesigned app and a matching marketing site, reached through small shippable slices so `main` stays releasable and CI-green throughout.

**Non-goals:** no changes to the data layer (`db/`, `services/`), the MCP server, or feature behavior beyond IA consolidation. No new features.

## 2. Visual identity — "warm editorial"

Direction to be finalized in Phase 1 mockups, within these boundaries:

- **Typography:** serif display face for headings and interview prose (candidates: Fraunces, Newsreader, Source Serif 4); humanist sans for UI chrome (candidates: Inter stays, or Public Sans). Reading-first type scale — interview transcripts and notes are the heart of the app and should read like a well-set book page (~65ch measure, generous leading).
- **Color:** paper/cream light theme (off-whites in the `#FAF7F0`–`#F4F1EA` band), near-black warm ink for text, one earthy accent (terracotta/amber/ochre family) plus a restrained support palette for status (verified/unverified/rejected). **Dark mode is warm dark** (deep browns/charcoals with warm tint), not inverted gray — dark mode support already exists and must be preserved.
- **Texture & shape:** soft paper-like surfaces, hairline rules instead of heavy card borders, modest radii. The knowledge graph is the one place allowed to be theatrical — luminous nodes on the paper background become a signature visual.
- **Fonts are self-hosted** (drop the Google Fonts CDN links in `client/index.html`). This also closes the "all data stays local" inconsistency flagged in the security review, and the CSP gets tightened accordingly (`font-src 'self'`, drop the fonts.googleapis/gstatic allowances).

## 3. IA consolidation (proposal — Phase 0 validates)

Current: 23 page components. Known overlaps to resolve:

| Today | Proposal |
| --- | --- |
| Dashboard / Topics / TopicDetail | Keep. Dashboard becomes a lighter "desk" view (recent activity + next actions), Topics remains the primary library |
| Notes / Bookmarks | Merge — bookmarks become a filter/tag within Notes |
| VerificationPage / insights inside TopicDetail | One "Review queue" surface; topic pages link into it pre-filtered |
| Assessment / AssessmentHistory / AssessmentResults | One Personality section with internal tabs (take / results / history) |
| Import / Export / Settings / Profile | One Settings area with sections (Profile, API key, Data in/out, Appearance) |
| NewSession / Session | Keep as the interview flow — this is the marquee screen and gets the most design attention |
| Search / KnowledgeGraph / Sandbox / Templates / Onboarding | Keep as-is structurally |
| PlaceholderPage | Delete |

Target: roughly 23 → ~14 routed screens. Phase 0's audit either confirms this table or amends it with evidence; route redirects preserve old URLs where feasible.

## 4. Phases

### Phase 0 — UX/IA audit (read-only, agent-driven)
Inventory every page: purpose, entry points, key actions, overlap with other pages, usage of shared components. Deliverable: an IA map confirming/amending §3, a navigation model (sidebar sections + order), and a shared-component inventory (what exists in `components/common`, `components/layout`, what the new system must cover). No code changes.

### Phase 1 — Identity lock via throwaway mockups
Standalone HTML mockups in `.design/mockups/` (gitignored), self-contained files, no build step. Mock **three screens** that stress the identity in different ways: the interview session (prose + chat), the dashboard (density + data), and the topic detail (mixed content + verification states). Produce **3 variants** of the warm-editorial direction (e.g. classic memoir / modern editorial / warm-with-graph-signature), each as a variant of the session screen; the winning variant then gets the other two screens plus a dark-mode pass. Owner picks; the choice is codified as a `DESIGN.md` token sheet (hex values, type scale, spacing scale, radii, shadows, component conventions) committed to the repo. **Gate: owner approval of one variant before any app code changes.**

### Phase 2 — Design system lands in the app (the "reskin ships early" step)
1. Encode tokens as CSS custom properties + Tailwind theme extension (`tailwind.config.js` maps to the variables; dark mode stays class-based).
2. Self-host fonts (woff2 in `client/public/fonts/`, `@font-face` in CSS, preload links, CSP tightened).
3. Build the core component kit in `client/src/components/ui/`: Button, Card/Surface, Input/Textarea/Select, Modal (restyle existing), PageHeader, EmptyState, Badge (incl. VerifiedBadge restyle), Tabs, Toast restyle.
4. Sweep existing pages to consume tokens/components where drop-in (colors, type, buttons) — layouts untouched.
Result: the whole app is visually coherent in the new identity even before any layout changes. Shippable on its own.

### Phase 3 — Screen migration in vertical slices
Order (highest impact first), one slice = mockup (only when layout changes) → implement → smoke test → commit:
1. **App shell & navigation** — new sidebar/IA from Phase 0, route consolidation + redirects.
2. **Session/interview flow** (NewSession + Session) — the marquee redesign: manuscript-style transcript, quieter chrome, voice/quick-reply affordances restyled.
3. **Dashboard** — the "desk" view.
4. **Topics + TopicDetail** — library + document feel, review-queue links.
5. **Knowledge graph** — D3 restyle to the signature look (node/edge palette, typography in labels, legend); interaction behavior unchanged.
6. **Onboarding** — first impression pass, matching the identity.
7. **Consolidations** — Notes+Bookmarks merge, Personality section, Settings area (per §3).
8. **Long tail** — Search, Sandbox, Templates, Import/Export inside Settings, NotFound.

Each slice keeps `npm run build` + 34-test suite green; slices 1, 2, and 7 (behavioral changes) also get a browser smoke test before commit.

### Phase 4 — Website sync (me.md-website repo)
Apply the same token sheet to the landing page, refresh screenshots/visuals to the new UI, fix the known content drift (missing Big Five, stale "Voice Input"/"Analytics" claims), keep the open-source research-project positioning. Small, single slice.

## 5. Verification

- Per slice: `npm run build`, `vitest run` (34 tests), and for layout/behavior slices a Playwright pass over the affected flow (boot, navigate, interact, console clean).
- Accessibility gates in Phase 2 and at the end: WCAG AA contrast for all token pairs (both themes), visible focus states on the component kit, reduced-motion respected in the graph.
- CSP re-verified after the font change (app must boot with zero console errors, as established in the release review).
- Final full pass: the Phase-3 checklist re-run across all ~14 screens in both themes.

## 6. Risks & mitigations

- **D3 graph restyle** is the most code-entangled slice — timebox it; palette/typography changes first, exotic effects only if cheap.
- **Route consolidation** can break deep links — add redirects from every removed route; grep for internal `navigate()`/`<Link>` targets.
- **Onboarding regressions** hurt most (first-run experience) — it ships late (slice 6) with a mandatory browser walkthrough.
- **Scope creep in mockups** — mockups are throwaway by contract; only the token sheet and approved layouts survive into the repo.

## 7. Execution notes

- Mockup phase is the owner's "claude design" playground; everything after Phase 1 is normal Claude Code implementation work.
- Phases 2+ each get their own implementation plan (via writing-plans) when reached; this spec is the umbrella.
- Commits follow the existing conventions; push cadence at the owner's discretion (CI gates on GitHub).

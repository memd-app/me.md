# Phase 0 UX/IA Audit — me.md client

Read-only audit of all 23 files in `client/src/pages/`, cross-referenced against `client/src/App.tsx` (router), `client/src/components/layout/{AppLayout,Sidebar}.tsx`, and internal `navigate()`/`<Link>` call sites. Validates §3 of `2026-07-04-design-revamp-design.md`.

## 0. Headline finding

**"23 pages" is a file count, not a route count.** Two files are not wired into the router at all:

- `LandingPage.tsx` (424 lines) — waitlist/marketing page with `/register`/`/login` links — never imported by `App.tsx` or anything else. Dead code.
- `PlaceholderPage.tsx` (21 lines) — never instantiated. Dead code.

`NotFoundPage.tsx` also links to `/login` and non-existent marketing routes (no such routes in `App.tsx:44-91`) — pre-existing broken links to clean up alongside deleting LandingPage.

Real live surface: **21 routed page components**; the consolidation framing is **21 → 14** (two dead files deleted outright, zero migration effort).

## 1. Page inventory

| Page | Route(s) | Purpose | Lines |
|---|---|---|---|
| DashboardPage | `/app`, `/app/dashboard` | "Desk" overview: stats, completeness, activity, quick actions | 763 |
| TopicsPage | `/app/topics` | Topic library, list/filter/paginate, suggestions | 1027 |
| CreateTopicPage | `/app/topics/new` | New-topic form | 496 |
| TopicDetailPage | `/app/topics/:id` | Topic detail incl. sessions and **inline "Related Insights" list** | 1061 |
| TemplatesPage | `/app/templates` | Pre-built interview templates gallery | 305 |
| NewSessionPage | `/app/session/new` | Pick topic, start interview | 354 |
| SessionPage | `/app/session/:id`, `/app/sessions/:id` (dup) | Interview/chat; inline distillation and message bookmarking | 2118 |
| NotesPage | `/app/notes` | Distilled per-session notes, 4 formats | 560 |
| BookmarksPage | `/app/bookmarks` | Bookmarked **chat messages** grouped by session | 271 |
| KnowledgeGraphPage | `/app/graph` | D3 force graph | 1117 |
| ProfilePage | `/app/profile` | Aggregated profile + Big Five snapshot + **quick markdown export (duplicate of ExportPage)** | 473 |
| AssessmentPage | `/app/assessment` | Take/resume Big Five | 776 |
| AssessmentResultsPage | `/app/assessment/:attemptId/results` | Attempt scores + generated insights | 868 |
| AssessmentHistoryPage | `/app/assessment/history` | Trend + compare attempts | 1021 |
| VerificationPage | `/app/verify` | Global pending-insight queue + conflicts + **privacy-tier toggle (duplicate of Settings→Privacy)** | 1449 |
| SearchPage | `/app/search` | Cross-entity search | 799 |
| ImportPage | `/app/import` | Content ingestion (URL/text/file/ChatGPT) | 872 |
| ExportPage | `/app/export` | Profile export flow (markdown/JSON) | 437 |
| SettingsPage | `/app/settings` | 5-tab shell: Profile / API Key / Database / Preferences / **Privacy (duplicate toggle)** | 834 |
| SandboxPage | `/app/sandbox` | With/without-context comparison | 384 |
| OnboardingPage | `/onboarding` | First-run wizard; **duplicates Import mechanics inline** | 1249 |
| NotFoundPage | catch-all `*` | Context-aware 404 | 85 |
| LandingPage / PlaceholderPage | **none — orphaned** | Dead code | 424 / 21 |

Sidebar (`Sidebar.tsx:17-32`) surfaces 14 items; Templates, CreateTopic, Assessment History/Results, Onboarding, NotFound are deep-link only.

## 2. Entry points (condensed)

- **Verify**: `DashboardPage.tsx:342`, `ImportPage.tsx:808,850`, `ExportPage.tsx:216`, `SearchPage.tsx:289`, `AssessmentResultsPage.tsx:801`, `ProfilePage.tsx:418` (plain `<a>` — forces full reload), sidebar. **No link from TopicDetailPage** despite inline insights (`TopicDetailPage.tsx:932-990`).
- **Assessment trio**: heavily cross-linked (`DashboardPage.tsx:387,426,432,457,486`, `ProfilePage.tsx:353,396`, `KnowledgeGraphPage.tsx:658`, `OnboardingPage.tsx:1227`, mutual links among all three) — already behaviorally one feature.
- **Bookmarks**: sidebar only; created inside SessionPage.
- **Session route aliases**: `NewSessionPage.tsx:72,110` navigates plural `sessions/:id`; `TopicDetailPage.tsx:169` singular `session/:id`. Both registered (`App.tsx:67-68`) — resolve to one canonical form in the shell slice.
- **KnowledgeGraphPage** is a hub: node clicks route to Topics (`:646,651,655`) or Assessment (`:658`).

## 3. Overlap analysis (load-bearing evidence)

| Overlap | Evidence | Implication |
|---|---|---|
| Privacy-tier toggle duplicated | `VerificationPage.tsx:266,635` and `SettingsPage.tsx:61-88` both call `editInsight(db, id, {privacyTier})` | Two live diverging implementations — consolidation must **delete one** |
| Markdown export duplicated | `ProfilePage.tsx:204-208` and `ExportPage.tsx` both call `services/profile.exportAsMarkdown` | Same job, two fidelities — decide which UI wins |
| Content-import triplicated | `OnboardingPage.tsx:7` and `ImportPage.tsx:6` both consume `services/import` (`importUrls/importText/importFile`) | Needs one shared component regardless of routes |
| "Import/Export" is two unrelated concepts | Settings "Database" tab (`SettingsPage.tsx:668-762`) = raw DB backup/restore; ImportPage = content ingestion; ExportPage = profile publishing | Folding content flows into Settings buries authoring in admin |
| Bookmarks ≠ Notes at the data layer | `bookmarks` table joins messages/sessions (per-message); `notes` table is per-session documents | "Filter within Notes" not implementable without data-model change — merge the **route** (tabs), not the dataset |
| VerificationPage is global, not topic-scoped | `services/insights.ts:119,138,169` take no `topicId`; no searchParams in VerificationPage | "Pre-filtered by topic" is **net-new work**, not a free merge |

## 4. Verdicts on spec §3

| Proposal | Verdict |
|---|---|
| Dashboard / Topics / TopicDetail keep | **CONFIRM** |
| Notes+Bookmarks merge | **AMEND** — one routed page, two tabs; separate datasets |
| One Review queue | **AMEND** — extract TopicDetail's insight block as shared `<InsightList>`; add `topicId` filtering to insights services (new work); privacy-tier toggle gets one owner (recommend Settings) |
| Personality section w/ tabs | **CONFIRM** — cleanest merge; keep `:attemptId/results` deep-linkable |
| Import/Export/Profile → Settings | **AMEND** — Settings' Database tab stays; ExportPage folds into **Profile**; ImportPage becomes an "Add content" affordance near Topics/Notes; dedup Onboarding's inline import |
| NewSession/Session keep | **CONFIRM** — canonicalize plural route |
| Search/Graph/Sandbox/Templates/Onboarding keep | **CONFIRM** — Templates becomes a sub-route of Topics |
| PlaceholderPage delete | **CONFIRM** — already unreachable |

## 5. Missing from the spec

- **LandingPage**: delete (dead code; the real marketing site is the separate repo).
- **NotFoundPage**: keep; clean its dead `/login` links.
- CreateTopicPage/TemplatesPage/SandboxPage/SearchPage: land unchanged (spec bookkeeping gap only).
- Duplicate privacy-tier and export implementations are live diverging code — explicit dedup decisions in Phase 3, not implied.
- Session route alias inconsistency — resolve in shell slice.

## 6. Recommended final IA (~14 destinations)

1. **Dashboard** — `/app/dashboard`
2. **Topics** — `/app/topics`, `/topics/new`, `/topics/:id`; Templates as sub-route/modal
3. **Session** — `/app/session/new`, `/app/sessions/:id` (canonical plural; singular kept as redirect)
4. **Notes** — `/app/notes` with Bookmarks tab (`/app/notes/bookmarks`)
5. **Personality** — `/app/personality` tabs take/results/history; `/app/personality/:attemptId/results` deep link
6. **Review queue** — `/app/review` (renamed from Verify), gains `?topicId=`
7. **Graph** — `/app/graph`
8. **Search** — `/app/search`
9. **Sandbox** — `/app/sandbox`
10. **Settings** — tabs: Profile(edit), API Key, Data (DB backup/restore + content import, clearly separated), Appearance, Privacy (single owner of tier toggle)
11. **Profile** — `/app/profile` reading surface; Export folds here (`/app/profile/export` or modal)
12. **Onboarding** — `/onboarding`
13. **NotFound** — catch-all
14. (Bookmarks/Assessment family/Import/Export counted as sub-routes)

### Route redirects required (follow the `App.tsx:86-87` `<Navigate replace>` pattern)

| Old | New | Breaking link sites |
|---|---|---|
| `/app/verify` | `/app/review` | DashboardPage:342, ImportPage:808,850, ExportPage:216, SearchPage:289, AssessmentResultsPage:801, ProfilePage:418, sidebar |
| `/app/assessment` | `/app/personality` | Dashboard:426,432,457,486, Profile:396, Graph:658, Onboarding:1227, internal trio links, Sidebar:24,62 |
| `/app/assessment/history` | `/app/personality?tab=history` | Dashboard:426 |
| `/app/assessment/:id/results` | `/app/personality/:id/results` | Dashboard:387, Profile:353, AssessmentPage:314,459, History:626 |
| `/app/bookmarks` | `/app/notes/bookmarks` | Sidebar:27 only |
| `/app/import` | Add-content surface (path TBD Phase 3) | ImportPage:800,807, Sidebar:29 |
| `/app/export` | `/app/profile` (export flow) | ExportPage:213, Sidebar:30, ProfilePage:298 quick-export |
| `/app/session/:id` | `/app/sessions/:id` | TopicDetailPage:169 |

## 7. Shared-component notes

`components/common/` holds only LoadingSpinner + Modal (thin). `Sidebar.tsx:17-32` hardcodes the nav array — single edit point for the new nav model. `components/verification/` (ConflictsSection, SwipeableCard) is consumed only by VerificationPage — carry into the Review queue as-is. VerifiedBadge lives at `src/components/` root, reused by TopicDetail + Notes — formalize into `components/ui/`.

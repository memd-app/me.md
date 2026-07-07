# me.md Tone of Voice — the verbal twin of DESIGN.md

Phase 2 of the copywriting overhaul. Date: 2026-07-05. Companion to `DESIGN.md` ("Modern Editorial") and successor to `.collab/copy/01-inventory.md`. Every string in `03-deck.md` was written against this document; every future string should be too.

**One sentence:** the copy sounds the way the design looks — a beautifully art-directed magazine feature about your own life, written by an editor who respects you enough not to sell to you.

---

## 1. Register

**Literate, quiet, precise.** Three tests every string must pass:

1. **Literate** — it could appear in a well-edited magazine. Full sentences where there is room; clean fragments where there isn't. Vocabulary is plain but exact ("draw out", "surface", "distill", "gather") — never inflated ("leverage", "unlock", "supercharge") and never cute ("aha moments", "let's gooo").
2. **Quiet** — the copy never raises its voice. No exclamation marks outside genuine warnings. No "successfully". Success is stated as fact ("Insight verified"), the way a checkmark is drawn, not shouted. If the design's rule is *one amber accent per screen*, the copy's rule is *zero exclamation points per screen*.
3. **Precise** — every claim survives cross-examination. Say what the thing does, name the mechanism, and stop. "Updates in place; never deletes your files" is the house style: a capability and its boundary in nine words.

Corollary: **adjectives don't do the work; nouns and verbs do.** "Smart Search" is banned; "Search across topics, insights, transcripts, and notes" is correct. If a sentence still works after deleting the adjective, delete the adjective.

## 2. Person and address

- **The product speaks as a considerate editor/interviewer**: "we" only where a human host would say it ("we'll begin gathering the story only you can tell"), and sparingly. Never "we" as a company ("our end", "our servers") — there is no company, and there are no servers.
- **The user is "you"**, always. Their material is "your knowledge", "your profile", "your story", "your verified insights". The possessive is the trust claim: everything in the product belongs to the user.
- **Direct address in display moments** may be warm and personal ("Where were we, {firstName}?") — this is the serif-italic voice. UI chrome (labels, buttons, meta) is impersonal and small-caps terse ("Awaiting review", "Queue status").
- **Imperatives are calm invitations**, not commands: "Take your time…", "Ask yourself something." Buttons are verb-first and short: "Go to Review", "Start a session", "Take the assessment".

## 3. How we talk about AI

**AI is a tool with a job title, not magic.** Rules:

- Prefer the **role noun** over "AI": *the interviewer* asks questions, *the assistant* answers in Converse. "AI" is acceptable as a plain modifier ("AI-guided interviews", "AI-extracted insights") — never as an agent of wonder ("AI that truly understands you" is banned; no external tool "understands" anyone).
- Name the **mechanism** where it builds trust: Anthropic API, your own key, IPIP-NEO model, MCP, Socratic questioning, Clean Language, 5 Whys. Named methods are our differentiation from "just chat" — use them.
- AI output is always **provisional until the human verifies it**. Extracted insights "await your review"; they are never presented as truths about the user. Confidence scores and "Rule-based" badges stay visible and honestly explained.
- Never anthropomorphize beyond the role: the interviewer "asks", "surfaces", "suggests" — it does not "know", "believe", "care", or "get you". Exception: Converse's established mode lines ("An assistant that knows you, grounded in your verified insights") — "knows" is acceptable there because the grounding clause immediately defines it.

## 4. Honesty rules

1. **Research project, said plainly.** me.md is "an open-source research project" / "an open-source experiment" — this framing appears on the website kicker, title tag, and footer, and is never contradicted by product-grade promises (no "enterprise-ready", no roadmap teases, no fake polish).
2. **Local-first is the lead trust claim.** The strongest true thing we can say: *your data lives in your browser and nowhere else; the only outbound calls go directly to Anthropic, with your own API key.* This belongs in the hero/features and error copy, not fine print. Every privacy sentence must remain literally true of the architecture (SQLite in the browser, localStorage key, direct API calls).
3. **No "successfully!", ever.** A completed action is reported as a quiet fact: "Insight verified", "Topic created", "Profile copied to clipboard". No exclamation marks in toasts, confirmations, or empty states. (Exclamation marks survive only in destructive-action warnings, where bluntness is kindness.)
4. **No support-channel fictions.** There is no support team, no "our end", no "the server". Errors name the true failure surface — the network, the Anthropic API, the browser — and the true recourse: try again, check your connection/key, or open a GitHub issue. "Contact support" is banned.
5. **No overclaims.** Not "perfect for", not "everything you need", not "truly understand". Browser-dependent features (voice input) are described with their dependency or not at all. Removed features are removed from copy the same day.
6. **Guards keep their teeth.** When we soften wording, the condition and its consequence stay intact ("Only verified insights will appear in your profile export" must survive every rewrite).

## 5. Canonical naming

| Concept | Canonical name | Use like this | Never |
|---|---|---|---|
| Review surface | **Review** | Page title "Review"; CTA "Go to Review"; common noun "the review queue" | "Verification queue" (as title), "Verification page", "Go to Verification Queue" |
| Insight state (pending) | **Awaiting review** | Small-caps status label and stat labels | "Pending review", "Pending verification" |
| Home surface | **Desk** / **the Desk** | Nav "Desk"; prose "the Desk"; CTA "Go to the Desk" | "Dashboard" in any user-facing string (route `/app/dashboard` stays in code) |
| Chat surface | **Converse** | Nav/kicker "Converse"; display title "Talk with your knowledge" | "Chat" in user-facing copy (route `/app/chat` stays) |
| Session notes | **Notes** | Distilled-session notes page and tab | — |
| Starred moments | **Bookmarks** | BookmarksPage title and tab; verb "star" ("Star messages…") | Titling the bookmarks page "Notes"; "aha moments" |
| Personality surface | **Personality** (nav) · **the Big Five assessment** (the artifact) | "Take the assessment"; "retake the assessment" | "test" ("Take the Big Five Test", "About This Test", "Resume Test") |
| Big Five duration | **120 questions · about 15 minutes** | Prose: "about 15 minutes"; meta lines: "~15 minutes" | "~10 minutes", any second number |
| Import surface | **Import** | Nav, page title, onboarding step label | Title "Import Context"; kicker "Context" on the Import page |
| Interviews list surface (nav + page) | **Interviews** | Nav "Interviews"; TopicsPage title "Interviews"; the page that lists your topics | "Topics" as the nav label or page title (the common noun "topic" stays valid app-wide) |
| API key | **Anthropic API key** | Settings, Converse guard, all key prompts | "Claude API key" (Claude is the model; the key is Anthropic's) |
| The export artifact | **your me.md file** / **your profile** | "a portable me.md file" | "your data export package" etc. |
| Export/sync surface (nav + page) | **Vault** | Nav "Vault"; ExportPage title "Vault"; "the vault" for the connected Obsidian folder | "Export & Sync" as the nav label |
| Interview surface | **interview sessions** / **a session** | "Finish a session", "during interview sessions" | "chats", "convos" |

## 6. Banned phrases

- "successfully" / any toast ending in "!"
- "contact support", "our team", "on our end", "the server" (there is no server)
- "truly understand(s) you", "know yourself better" as a promise, "unlock", "supercharge", "empower", "seamless", "effortless"
- "Smart" as a feature prefix; "perfect for…"
- "aha moments", "let's dive in", "you're all set!"
- "simple, human-centred process" and its family (self-praise adjectives: simple, easy, powerful, beautiful)
- "everything you need"
- "multi-bucket distillation" and other internal jargon in user-facing strings
- Title Case Headlines ("Create New Topic") — see §7
- Feature names for removed features: Context Sandbox, Quick-Win Sessions, agreement scale, assessment history charts

## 7. Punctuation and typography conventions

Match the editorial identity in `DESIGN.md`:

- **Sentence case everywhere words speak as sentences**: page titles, subtitles, buttons, empty states ("Verification queue" was right about case, wrong about name). Small-caps chrome is uppercase by CSS, not by string — write the source string in sentence case and let the styling shout quietly.
- **Em dash, spaced ( — )** for appositions and turns of thought; it is the house mark. In JSX use `&mdash;` or `—` consistently with the surrounding file.
- **Middot separators (·)** for meta lines: "120 questions · ~15 minutes · IPIP-NEO". No slashes, no pipes.
- **Ellipsis as the single character (…)** for in-progress states and reflective placeholders ("Take your time…", "Analyzing conversation…"). Progress steps end in "…", never "!". Prefer `…` over `...` in new strings; match the file if it already interpolates.
- **Terminal periods**: yes on full sentences (subtitles, empty states, guards); no on fragments (toasts like "Insight verified", labels, buttons, stat captions).
- **Numbers**: numerals for counts and durations ("120 questions", "3–5 topics" with an en dash for ranges); the design's two-digit editorial markers ("01", "02") belong to layout, not prose.
- **Quotation marks** around literal UI names when referring to them in prose ('the "exportable" privacy tier').
- **No emojis** in product copy. Status is typographic (small caps, strikethrough, amber), never a colored pill or a ✅.
- **The serif-italic voice** (Newsreader italic) is reserved for the user's own words and reflective invitations — anything set in it must read as something a person could say slowly.

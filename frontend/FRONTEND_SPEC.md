# Secure Examination Management System — Frontend Specification

**Companion to:** `BACKEND_SPEC.md` v1.0 | **Event:** Technoverse 5.0 / Web-e-Thon | **Version:** 1.0

---

## 1. Goals and Hard Rules

1. **Zero dummy data.** No hard-coded users, exams, questions, scores, charts, or "lorem ipsum" anywhere in the shipped bundle. Every number and row on screen comes from the API. When the API returns nothing, the UI shows a purposeful **empty state** (see §9), never fake content. Demo content lives only in the backend seed script.
2. **Auto-connect to the backend.** The frontend needs no code change or manual wiring. It discovers the API, waits for it, and recovers when it appears (§3).
3. **Server is the source of truth.** The client never computes authoritative time, scores, permissions or eligibility. It displays what the server returns and hides what the server forbids, but never relies on hiding for security.
4. **Every secondary feature is reachable and visible** in the main flow, not buried (feature discoverability is graded).
5. **Accessible and responsive by default** (WCAG 2.2 AA, 320 px → 2560 px, touch + keyboard).
6. **Distinct visual identity** (§6), not a template look.

---

## 2. Technology Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | React 18 + TypeScript (strict) + Vite 5 | Fast builds, static deploy |
| Routing | TanStack Router (file-based, typed, route guards) | Loader-level auth/role guards |
| Server state | TanStack Query v5 | Caching, retries, invalidation, offline mutation paused state |
| Client state | Zustand (small slices) | UI prefs, connection state, exam runtime |
| Forms | React Hook Form + Zod resolver | Same rules as backend |
| Styling | Tailwind CSS v4 with CSS-variable design tokens | No component-kit look |
| Primitives | Radix UI (unstyled) | Dialog, Popover, Tabs, Tooltip, Select, Toast — accessible behaviors, our own skin |
| Charts | visx (custom SVG) | Matches the visual identity; no stock chart-library look |
| Rich text | Markdown render with `rehype-sanitize`; editor: CodeMirror 6 (markdown mode) + live preview | Mirrors backend sanitization |
| Math | KaTeX (optional per question) | Exam content |
| Offline | Dexie (IndexedDB) + Service Worker (Workbox) | Answer queue, app shell cache |
| Realtime | `EventSource` (SSE) wrapper with resume | `/stream` endpoints |
| PDF | Not built client-side; fetched from `/reports` | Blob download with auth |
| QR | None client-side needed (server embeds) | Verify page is public |
| Icons | Lucide, customized stroke 1.5 | Consistent, no emoji |
| Fonts | Self-hosted via Fontsource (no CDN) | Privacy, offline, no external requests |
| Testing | Vitest + Testing Library, Playwright (E2E), axe-core, MSW **for unit tests only** | MSW never bundled in production builds |
| Quality | ESLint, Prettier, TypeScript `noUncheckedIndexedAccess`, Lighthouse CI | |
| i18n | `i18next`-ready (English default; Urdu with RTL layout support via logical CSS properties) | Bonus accessibility |

---

## 3. Backend Auto-Connection (core requirement)

### 3.1 API base URL resolution (priority order)
1. **Runtime config** `GET /config.json` served next to `index.html` (fetched with `cache: no-store` before app boot): `{ "apiBaseUrl": "https://api.example.com/api/v1" }`. Lets ops repoint without rebuilding.
2. Build-time `VITE_API_BASE_URL`.
3. **Same-origin default** `/api/v1` (works behind Nginx/Caddy reverse proxy, the default docker-compose setup).
4. Dev: Vite dev-server proxy `/api → http://localhost:4000` so `npm run dev` connects to a locally running backend with no config.

If none responds, the app still loads and shows the **Connection Gate** (below). It never crashes to a white screen.

### 3.2 Boot sequence
```
load config.json -> create ApiClient -> probe GET /health/ready (timeout 4 s)
   ready      -> fetch GET /auth/me (refresh cookie flow) -> render app
   unreachable-> Connection Gate (retry w/ exponential backoff 1s,2s,4s,8s… max 15s, jitter)
   degraded   -> render app with a persistent "Service degraded" banner
```
- The probe keeps running in the background every 15 s while the app is open, and immediately on `online` events and `visibilitychange`.
- The moment the backend becomes reachable the Gate dismisses itself and the app boots — **no manual refresh needed**. Pending TanStack Query fetches are re-triggered via `queryClient.resumePausedMutations()` and `invalidateQueries()`.

### 3.3 Connection state machine (Zustand `connection` slice)
States: `BOOTING → ONLINE ⇄ DEGRADED ⇄ RECONNECTING → OFFLINE`
- `ONLINE`: last request or probe succeeded in < 3 s.
- `DEGRADED`: latency p50 > 1.5 s, or intermittent 5xx/timeouts (≥ 3 of last 10 requests).
- `RECONNECTING`: failed request/probe, backoff retry in progress, shows countdown "Retrying in 8 s" and a **Retry now** button.
- `OFFLINE`: `navigator.onLine === false` or probe failing > 30 s.
Signals combined: `online/offline` events, probe results, request outcomes (the HTTP client reports into the slice), SSE open/close.

### 3.4 HTTP client (`ApiClient`)
- `fetch` wrapper with: base URL, `credentials: 'include'`, JSON parse, `X-Request-Id` per call, `Idempotency-Key` for flagged mutations (`start attempt`, `submit`, `enroll`, `import`, `dispute`), timeout (10 s default; 5 s for autosave), `AbortController` integration with TanStack Query.
- **Auth refresh:** on 401 `AUTH_TOKEN_EXPIRED`, a single shared in-flight `POST /auth/refresh` (mutex), then replay queued requests once. Failure → logout + redirect to `/login?next=`.
- **Retry policy:** GET: 3 retries with backoff on network error/502/503/504 only. Mutations: never auto-retry unless idempotent (flagged) — then 2 retries. 4xx never retried.
- **Typed contracts:** types generated from `/openapi.json` (`openapi-typescript`) at build (`npm run api:types`); Zod schemas mirrored/shared via the backend package or generated. Responses validated in dev mode; mismatches reported to console + toast in dev, silently logged in prod.
- **Error normalization:** every failure becomes `AppError {code, message, details[], requestId, retryable, status}`; UI maps `code` to human copy via a dictionary (`errors.ts`), falls back to server `message`.
- **Server time sync:** client records `serverTime` from responses (header `Date` and body `serverTime`), maintains `offsetMs` and monotonic reference (`performance.now()`), used **only** for display countdown; the authoritative `remainingSeconds` from each save/heartbeat response overrides drift.
- **Version handshake:** responds `X-API-Version`; if major mismatch, shows "App update required — reload" modal.

### 3.5 Connection Gate UI
Full-screen, calm, on-brand (not an error page): a stylized "paper tape" progress line, text "Looking for the examination server…", the resolved API host, last attempt time, next retry countdown, **Retry now**, and a collapsible "Diagnostics" (config source, probe status code, latency, browser online flag, request ID). It adapts copy to the user's state (inside an active exam, it is replaced by the exam-level Network Bar, §8.5, so the candidate's work is never blocked).

---

## 4. Information Architecture

### 4.1 Route map
```
Public
  /login                      Sign in
  /forgot-password, /reset-password/:token
  /verify/:code               Public result verification (QR target)
  /change-password            (forced when mustChangePassword)

Candidate  (role: CANDIDATE)
  /app                        Dashboard (Available / Upcoming / Completed)
  /app/exams/:examId          Exam briefing: instructions, rules, eligibility, readiness check
  /app/attempt/:attemptId     Exam workspace (full-screen layout)
  /app/attempt/:attemptId/review   Pre-submit review
  /app/results                My results
  /app/results/:attemptId     Result detail + dispute entry + PDF
  /app/disputes, /app/disputes/:id
  /app/settings               Workspace preferences, account

Examiner  (role: EXAMINER)
  /studio                     Overview (my exams by lifecycle, grading queue counts, announcements)
  /studio/exams               List + filters
  /studio/exams/new           Create wizard
  /studio/exams/:id           Exam hub (tabs: Overview · Questions · Candidates · Monitor · Grading · Results · Analytics · Disputes · Settings)
  /studio/exams/:id/sandbox   Launch as candidate (same workspace, sandbox banner)
  /studio/questions           Question bank (categories tree + table + editor)
  /studio/imports             Import center (candidates / questions) + history
  /studio/disputes            Dispute inbox

Administrator (role: ADMIN)
  /admin                      Platform overview (health, counts, queue state)
  /admin/users                User management
  /admin/users/:id
  /admin/audit                Audit log explorer
  /admin/disputes             Escalated disputes
  /admin/system               Job queue, dead letters, build/API version
```
Route guards: loader checks `me.role`; wrong-role access redirects to the role's home and shows a toast. Guards are UX only — all enforcement is server-side, and 403/404 responses are handled gracefully on every screen.

### 4.2 App shells
- **Candidate shell:** minimal top bar + content; during an attempt, switches to the **Exam workspace shell** (no global nav, no distractions).
- **Examiner/Admin shell:** left rail (collapsible, icons + labels), top bar with search/command palette (`Ctrl/⌘+K`), notifications bell, connection pill, user menu. On < 1024 px the rail becomes a bottom tab bar (primary 4) + "More" sheet.

---

## 5. Project Structure
```
frontend/
  public/            config.json (runtime, no secrets), manifest.webmanifest, sw.js
  src/
    app/             main.tsx, providers.tsx, router.tsx, boot.ts
    api/             client.ts, errors.ts, endpoints/*.ts, types.gen.ts, sse.ts
    features/
      auth/ users/ exams/ questions/ enrollments/ attempt/ monitor/
      grading/ results/ analytics/ reports/ imports/ sandbox/
      preferences/ scratchpad/ integrity/ resilience/ disputes/
      announcements/ audit/ verify/ connection/
        (components/ hooks/ queries.ts schema.ts utils.ts per feature)
    components/      ui/ (our primitives), layout/, charts/, feedback/
    stores/          connection.ts, session.ts, prefs.ts, attemptRuntime.ts
    offline/         db.ts (Dexie), queue.ts, sync.ts
    styles/          tokens.css, base.css, motion.css, print.css
    lib/             format.ts, time.ts, a11y.ts, guards.ts, permissions.ts
    i18n/
  tests/             unit/, e2e/, a11y/
```
Feature modules own their queries and never import from each other except via `components/` and `api/`.

---

## 6. Visual Identity — "Paper & Ink"

**Concept:** An examination is a physical ritual: paper, ink, stamps, margins, ruled lines. The UI borrows that tactile language in a restrained, modern way — an editorial exam-paper feel, instead of the usual purple-gradient dashboard. Calm, serious, trustworthy, and a little distinctive.

### 6.1 Colour tokens (CSS variables, light default + dark "Night Paper")
| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#F6F2EA` | `#14161A` | App background (warm, never pure white) |
| `--paper-raised` | `#FCFAF5` | `#1B1E23` | Cards, sheets |
| `--paper-sunken` | `#EDE7DA` | `#101216` | Inputs, wells |
| `--ink` | `#16202E` | `#ECE8DF` | Primary text |
| `--ink-soft` | `#4A5568` | `#A9AFB8` | Secondary text |
| `--rule` | `#D9D1BF` | `#2A2E35` | Hairlines/borders |
| `--indigo-ink` | `#1F3A5F` | `#8FB0E0` | Primary actions, links |
| `--vermilion` | `#D8432B` | `#F0735C` | Stamp accent, urgent, destructive, time-critical |
| `--moss` | `#3F6B4A` | `#79B58A` | Success, saved, correct |
| `--ochre` | `#B7791F` | `#E3A94B` | Warnings, marked-for-review |
| `--teal-pencil` | `#2B7A78` | `#6CC0BC` | Info, scratchpad accents |
All text/background pairs verified ≥ 4.5:1 (7:1 for exam body text). Status is never conveyed by colour alone (always icon + label). A **High-contrast** theme is also provided.

### 6.2 Typography (self-hosted)
- **Display / headings:** *Fraunces* (variable, optical size, soft serif) — page titles, exam titles, result scores.
- **UI / body:** *Instrument Sans* (or *Geist*) — controls, tables, paragraphs.
- **Numerals / timers / IDs:** *JetBrains Mono* with tabular figures — timers, marks, codes.
- Scale (rem, fluid via `clamp`): 12 · 14 · 16 · 18 · 22 · 28 · 36 · 48 · 64. Body 16 px min on mobile; exam body adjustable 14–24 px by candidates.

### 6.3 Signature visual elements
- **Ruled-paper texture:** very subtle horizontal rule lines and a left "margin line" in the exam workspace and scratchpad (CSS gradients, no images; disabled under reduced-motion/high-contrast).
- **Stamp motif:** statuses use rounded-rectangle "rubber stamp" badges with slightly rotated (−2°), double-border style — `PUBLISHED`, `ONGOING`, `GRADED`, `VERIFIED`. Used sparingly for state, not decoration.
- **Marginalia:** secondary info (marks, difficulty, hints) sits in a right "margin" column on wide screens, like annotations on a printed paper; collapses beneath content on narrow screens.
- **Tape-style progress:** progress shown as a segmented "answer sheet" strip (one cell per question) rather than a generic bar.
- **Corners & elevation:** 6 px radius (small, not pill-everything); elevation uses soft warm shadows + 1 px rules instead of heavy drop shadows.
- **Numbers as heroes:** large Fraunces numerals for scores/countdowns with a small mono caption.
- **No:** purple/blue gradients, glassmorphism, blobs, emoji icons, stock illustrations, centered hero cards on gradients, generic dashboard "stat tile ×4 in a row" without context.
- **Illustration:** simple SVG line drawings (pencil, bubble sheet, hourglass) drawn in the ink colour, used only in empty states.

### 6.4 Motion
- Purposeful, 120–220 ms, ease-out cubic; stamp-press animation on publish/submit confirmations; answer-cell fill when saved; countdown digits use a subtle tick (no flips).
- `prefers-reduced-motion`: all non-essential motion off; no parallax anywhere.

### 6.5 Layout system
- 4 px spacing grid; 12-column fluid grid; content max 1280 px (studio), reading width 68ch (exam text).
- Breakpoints: `xs 360`, `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`. Container queries used inside cards/tables so components adapt to their slot, not just the viewport.
- Tables degrade to **stacked record cards** under `md`; modals become bottom sheets under `sm`; wizards become single-step screens.
- Safe-area insets respected (notch devices); `100dvh` units; touch targets ≥ 44 × 44 px.

---

## 7. Component Library (own primitives over Radix)
`Button` (primary/secondary/quiet/danger, loading state w/ spinner + disabled, `aria-busy`), `IconButton`, `Field` (label, hint, error, `aria-describedby`), `Input`, `Textarea` (auto-grow, counter), `Select`, `Combobox`, `Checkbox`, `Radio`, `Switch`, `NumberStepper`, `DateTimePicker` (timezone-aware, shows server tz, validates window), `DurationInput`, `Stamp` (status), `Tag`, `Card`, `Table` (sortable, sticky header, column visibility, row selection, virtualization > 200 rows), `RecordCard`, `Tabs`, `Dialog`, `Sheet`, `Popover`, `Tooltip`, `Toast`, `Banner`, `EmptyState`, `Skeleton` (shaped like real content), `Pagination`, `Breadcrumbs`, `CommandPalette`, `FileDropzone`, `ProgressStrip`, `Countdown`, `Markdown`, `CodeEditorLite`, `Stat`, `ChartFrame`, `ConfirmDialog` (typed confirmation for destructive actions), `ConnectionPill`, `SaveIndicator`, `Kbd`.
Each documented with keyboard behavior and ARIA pattern; Storybook (optional) for QA.

---

## 8. Screen Specifications

### 8.1 Login (`/login`)
Split layout: left a quiet ruled-paper panel with product name and one-line purpose (static brand copy only); right the form (email, password with show/hide, "Forgot password?"). Inline field validation (Zod), generic server error ("Email or password is incorrect"), lockout message with live countdown from `Retry-After`/`locked_until`, connection pill visible. On success → role home or `next`. If `mustChangePassword` → `/change-password`. No role selector (role comes from the server). On mobile, stacked, brand header compact.

### 8.2 Candidate Dashboard (`/app`)
- Header: greeting by name (from `/auth/me`) and a **server-synced clock** (date/time + timezone).
- Three tabs bound to `GET /me/exams?bucket=`: **Available now**, **Upcoming**, **Completed**.
- Exam card: title, examiner name, stamp status, window (start–end), duration, total marks, **access status** (e.g., "Opens in 02:14:10", "Open — enter now", "Window closed", "Attempt in progress — Resume") derived from the server's eligibility reason codes. Primary CTA changes (`View briefing`, `Resume`, `View result`).
- Live countdown ticks locally from server offset; at 0 the card re-queries the server (never flips access client-side without confirmation).
- A "Needs attention" strip on top for in-progress attempts, new announcements, results just published, dispute updates.
- Empty states: "No examinations assigned yet. Your examiner will enroll you; this page updates automatically." Loading → skeleton cards.

### 8.3 Exam Briefing (`/app/exams/:id`)
Instructions rendered from Markdown, rules summary (duration, marking incl. negative marking and multi-select rules in plain language, navigation allowed, attempts), integrity notice with explicit acknowledgement checkbox (what is monitored, what isn't, "indicators are not proof"), **Readiness check**: network latency to server (uses `/time` ping), clock offset display, browser capability (IndexedDB, fullscreen API, storage persistence), and saved preferences preview. **Start exam** enabled only when the server says eligible + notice acknowledged. Start uses an idempotency key; double click safe; resume if active attempt exists.

### 8.4 Exam Workspace (`/app/attempt/:id`) — the centrepiece
Full-screen shell. Layout (≥ 1024 px):
```
┌ Header: exam title · section · [Network bar] · [Timer] · [Submit] ┐
│ Left: Navigator (answer-sheet grid)   Center: Question paper        Right margin: marks/difficulty/flag, scratchpad dock │
└ Footer: Prev · Mark for review · Clear · Next ─ Save status ┘
```
- **Question paper:** question number, Markdown/KaTeX stem, options as large touch-friendly rows with letter keys (A–F). MCQ single = radio semantics; multi = checkbox semantics with "Select all that apply" label and the scheme's rule stated. Written = textarea/editor with live word counter vs `maxWords`, no paste restrictions imposed by UI (any paste is only reported to server as an indicator, with a visible policy).
- **Navigator:** grid of numbered cells with 4 distinguishable states using shape + colour + label: unanswered (outline), answered (filled with check), marked-for-review (flag corner), current (ink underline); legend visible; counts summary "12 answered · 3 marked · 5 left". Jump by clicking or `Ctrl+Alt+N`.
- **Timer:** mono numerals; shows `mm:ss` (or `h:mm:ss`), turns ochre at 10 min and vermilion at 1 min with a polite `aria-live` announcement at 10/5/1 min only (not every second). Value derived from the server `remainingSeconds` + monotonic clock; re-synced after every save/heartbeat response. Device clock changes have no effect. Optional "hide timer, show only at thresholds" preference (accessibility).
- **Autosave:** debounced (600 ms after change, immediate on selection change for MCQ, 2 s idle for written) → `PUT /attempts/:id/answers/:aqId` with increasing `clientSeq`. `SaveIndicator` states: `Saved 10:04:12` · `Saving…` · `Queued (n) — will sync` · `Failed — retrying`. Never silent.
- **Refresh / return:** on mount, `GET /attempts/:id` rebuilds everything (answers, flags, remaining time, preferences); local unsynced queue from IndexedDB is merged and flushed first.
- **Time up:** at deadline the UI locks input, shows "Time is up — finalizing", calls submit (idempotent), and polls the attempt until status is final; displays confirmation stamp "SUBMITTED". If the server reports earlier finalization (auto-submit), it syncs to that state.
- **Submit flow:** `/review` page lists every question with state, unanswered/marked filters, and a confirmation dialog stating counts; submission is disabled while saves are pending and shows "Syncing 2 answers…" before enabling. On success: stamp animation + receipt (time, answers count, reference ID); candidate cannot re-enter.
- **Announcements:** SSE → non-blocking banner at the top with a sound-free chime option off by default; stored in a drawer ("Announcements (2)"), with unread count; also delivered via heartbeat fallback.
- **Keyboard:** `←/→` prev/next, `1–9`/`A–F` select option, `M` mark, `S` toggle scratchpad, `?` shows shortcut sheet; all with visible focus rings; screen-reader labels on every control; question change announces "Question 7 of 40, 2 marks".
- **Mobile layout (< 768 px):** single column; navigator opens as a bottom sheet; scratchpad as a full-height sheet; sticky bottom action bar; timer pinned in header.
- **Fullscreen:** offered, not forced. If STRICT integrity level, a dismissible prompt requests fullscreen; exits are reported as indicators only, with a neutral message ("Fullscreen was exited. This is recorded for your examiner."). No blocking modal that prevents answering.

### 8.5 Network-Aware Interface (secondary 4.1)
`NetworkBar` pinned in the workspace header, driven by the connection slice + save queue:
- **Online:** small moss dot "Connected · 42 ms".
- **Unstable:** ochre banner "Connection unstable — your answers are saved on this device and will sync" with queue size.
- **Offline:** vermilion banner "You're offline. Keep working — answers are kept on this device. The timer keeps running on the server." Includes explicit statement that no extra time is granted automatically.
- **Reconnected:** brief moss confirmation "Back online — synced 5 answers" and, if the server recorded an interruption credit, a line "Interruption recorded: 00:42 (pending review)".
- Behavior: heartbeat every 10 s (`POST /attempts/:id/heartbeat`), exponential retry for the queue, `navigator.sendBeacon` flush on `pagehide`, `beforeunload` warning only when unsynced items exist. Queue persists in IndexedDB keyed by attemptId, ordered by `clientSeq`, flushed through `answers:batch`, cleared on server ACK only.

### 8.6 Digital Scratchpad (4.8)
Dockable panel (right on desktop, sheet on mobile): tabs **Notes** (monospace/plain text) and **Sketch** (canvas with pen, eraser, 3 sizes, undo/redo, pressure-aware via Pointer Events, touch + stylus), simple calculator-free by design (no external tools). Autosaves to `PUT /attempts/:id/scratchpad` every 5 s when changed; content restored on reload; clearly labelled "Not graded". Size meter vs 100 KB limit.

### 8.7 Customizable Workspace (4.7)
`/app/settings` and quick popover inside the exam: theme (Paper / Night / High contrast), text size slider (live preview), line spacing, layout (single column / split with side navigator), navigator position (left/right/bottom), option density, show/hide timer, reduced motion, colour-blind-safe palette, dyslexia-friendly font toggle (Atkinson Hyperlegible), keyboard hints on/off. Saved via `PUT /me/preferences`, cached locally for instant first paint, and applied automatically at the next exam start. Live preview pane shows a sample question rendered with current settings (static sample string from the i18n bundle, labelled "Preview").

### 8.8 Results (Candidate)
List from `/me/results`: title, date, score as large numeral, percentage, grade label, stamp "VERIFIED" (when a verification code exists). Detail page: score summary, per-section and per-question breakdown (shown only when the server returns it), answer key only if the server allows, feedback from examiner on written answers, **Download PDF** (authenticated blob download with progress), **Dispute** entry point (visible only inside the dispute window with remaining time), result history if superseded. Unpublished → neutral "Results not published yet" state.

### 8.9 Verification page (`/verify/:code`) — public
Own minimal layout, no navigation to the app. Calls `GET /verify/:code`. Valid: large VALID stamp, exam title, institution, issue date, percentage, masked name. Superseded: ochre notice with link to the newer code. Revoked/not found: neutral message. Never shows email, registration number, or answers. Rate-limit (429) handled with a polite retry message.

### 8.10 Examiner Overview (`/studio`)
Real data only: lifecycle lanes (Draft · Published · Ongoing · Completed) as columns on desktop / accordion on mobile; "Ongoing now" live rail showing active attempt counts (SSE-driven); "Grading queue" with count per exam; "Disputes awaiting you"; recent announcements sent; upcoming exam starts with countdowns. Empty: guided first-run card "Create your first examination" with the three steps (questions → exam → enroll) as links.

### 8.11 Exam Creation Wizard (`/studio/exams/new`, edit mode reuses)
Steps with progress rail (stepper becomes a compact progress label on mobile), autosaved as DRAFT:
1. **Basics:** title, instructions (Markdown editor + preview), schedule (start/end with timezone), duration, total marks (auto-suggested from questions, editable but validated), pass marks.
2. **Rules:** shuffle questions/options, multi-select scheme (with plain-language preview and worked example computed by the server's preview endpoint), negative marking, max attempts, late entry, integrity level (with privacy description), fairness mode, resilience policy, dispute window, show-answers policy.
3. **Questions:** pick from bank (filters, search, multi-select) or "auto-select by blueprint" (category × difficulty × count slots → server previews coverage and paper-difficulty spread), drag-and-drop reorder with keyboard alternative (move up/down), per-question marks override, running total vs exam total.
4. **Candidates:** enroll by search, paste emails, or import CSV (links to Import center).
5. **Review & publish:** server-driven readiness checklist from `GET /exams/:id/preview` (each failing rule links to the step to fix), candidate-eye preview via **Sandbox** button, publish confirmation with typed title for safety. After publish, locked fields become read-only with explanation tooltips (backend §8.1).
Optimistic-lock conflicts (`412`) show a "This exam changed elsewhere — review differences / reload" dialog.

### 8.12 Exam Hub tabs
- **Overview:** state stamp, key facts, timeline, quick actions (Sandbox, Announce, Export).
- **Questions:** ordered list, marks, totals; locked after attempts exist.
- **Candidates:** enrollment table (status, attempt status, extra-time accommodation edit with reason), add/remove, import.
- **Monitor** (live, SSE): summary counters; attempt table with progress segment-strip, answered count, last seen, connection quality, incident count with severity chips; row drill-in drawer with event timeline and the permanent disclaimer "Indicators are not conclusive evidence of misconduct"; actions: extend time (reason required), force submit (typed confirm), review incidents (Dismiss/Confirm with note). **Announcement composer** (500 char counter, priority) with delivery count.
- **Grading:** queue by question, side-by-side answer + rubric + marks input (validated 0–max, step 0.25), keyboard-driven (`J/K` next/prev, `Enter` save & next), optional **blind mode** (hides identity), progress ring "34/58 graded", re-grade and answer-key override tools with impact preview. Shows `gradingState` and blockers for publishing.
- **Results:** table with filter/sort, per-candidate drill-down, grading state, **Publish** (all/selected) with pre-flight checks, unpublish with reason.
- **Analytics:** (all from `/analytics*`) score distribution histogram, mean/median/stdev/pass-rate, completion rate, time-spent distribution, category performance, **Question analytics** table + detail (skip rate, correctness, option distribution/distractor chart, discrimination index, difficulty observed vs labelled, flags), **Fairness panel** (paper difficulty spread, cohort means). Every chart has a data-table toggle and text summary for accessibility.
- **Disputes:** inbox filtered to this exam.
- **Settings:** edit allowed fields, archive.
- **Reports:** download exam PDF, results CSV.

### 8.13 Question Bank (`/studio/questions`)
Three-pane on desktop (category tree · list · detail/editor), stacked on mobile. Filters: category, difficulty, type, tags, search. Editor: type switch, Markdown stem with preview, options builder (add/remove/reorder, mark correct, validation matching backend rules), marks, difficulty, tags, explanation, rubric (written). Shows usage ("used in 3 exams"), version, analytics sidebar (observed difficulty from real attempts), archive/duplicate. Editing a used question explains versioning ("existing attempts are unaffected").

### 8.14 Import Center (4.4)
Drop zone (CSV/JSON), template download, type selector, options (dry-run default, atomic vs skip-bad-rows, auto-create categories, auto-enroll in exam). Flow visualised as **Upload → Validate → Preview → Commit**. Preview shows valid/invalid counts and an **error table** (row, column, message, offending value) with filter + "Download errors CSV"; commit disabled until acknowledged. Live progress for large files via polling `/imports/:id`. Imported candidates' temporary credentials: one-time download panel with warning. History list of past imports.

### 8.15 Reports (4.2, 4.6)
Download buttons across hub/results use a shared `useDownload` hook (authenticated fetch → blob → save, progress, error toast with request ID). PDF preview in an in-app viewer (iframe/PDF.js-lite) optional. Result report page shows verification code, copy button, and "Open public verification page".

### 8.16 Sandbox (4.3)
"Preview as candidate" button launches the real workspace with a persistent, unmissable **SANDBOX** ribbon + banner "Nothing here affects real submissions, results or statistics". Exit and "Reset sandbox" actions. Works from DRAFT.

### 8.17 Disputes
- **Candidate:** create form (type, linked question/answer picker populated from the actual attempt, reason with 20-char minimum and counter, incident evidence attached automatically), my disputes list, timeline view (status stamps, reviewer notes, evidence), withdraw.
- **Examiner/Admin:** inbox with SLA badges (due/overdue), detail with question snapshot, candidate answer, rubric, grade history, interruption log; resolve form (Accept / Reject / Partial, new score validation, note required; for ambiguous question — policy picker with impact preview of affected candidates and score deltas); escalate to admin; four-eyes warnings surfaced from server responses.

### 8.18 Admin
- **Overview:** `/admin/stats`, API health (`/health/ready`), queue depth, DB state; no invented numbers.
- **Users:** table + create dialog (temporary password shown once), role change, activate/deactivate with confirmations; guard messages from the server (last admin).
- **Audit:** filterable (actor, entity, date, action), diff viewer (before/after JSON), hash-chain verification indicator.
- **System:** job queues, failed jobs with retry, API version/build info.

### 8.19 Notifications & Command Palette
Bell with unread count (`/me/notifications` + SSE), grouped by type, mark read. `Ctrl/⌘+K` palette: navigate, search exams/questions/candidates (server-side search endpoints), run actions. Hidden in candidate exam workspace.

---

## 9. States Every Screen Must Handle
| State | Treatment |
|---|---|
| Loading | Skeletons shaped like final content; no spinners-only pages; min display 150 ms to avoid flicker |
| Empty | Purposeful message, why it's empty, next action; line illustration; **never sample data** |
| Error | Human message from error dictionary + "Try again" + request ID (copyable) in details |
| Forbidden / Not found | Dedicated screens; 404 for resources the user can't know about |
| Offline | Cached read-only content where safe; mutations paused with a visible "waiting for connection" chip; exam answers queued |
| Stale | `Updated 12 s ago` + background refetch indicators for live views |
| Conflict | Version-mismatch dialog with reload/compare |
| Permission-limited | Controls disabled with explanatory tooltips (and server still enforces) |
| Partial success | Bulk operations report per-item outcomes |

---

## 10. State, Caching, Realtime

- **Query keys** namespaced by resource + params; stale times: dashboards 15 s, lists 30 s, question bank 60 s, exam config 30 s, results 60 s, `me` 5 min. Mutations invalidate precise keys.
- **Live views** use SSE (`/exams/:id/monitor/stream`, `/attempts/:id/stream`, notifications). Wrapper handles auth (cookie/`fetch`-based stream with bearer for cross-origin via `@microsoft/fetch-event-source`), `Last-Event-ID` resume, backoff reconnect, and falls back to 5 s polling when SSE fails. Events patch the Query cache directly (`setQueryData`) to avoid refetch storms.
- **Attempt runtime store** (`attemptRuntime`): `{attemptId, deadlineAt, serverOffset, remainingSeconds, answers{}, flags{}, clientSeq, queue[], saveState, sessionEpoch}`. Persisted to IndexedDB (not localStorage) for crash recovery. Second-device takeover (`sessionEpoch` mismatch from the server) switches the old tab to read-only with an explanatory screen.
- **Cross-tab:** `BroadcastChannel` informs a second tab of the same attempt ("This exam is open in another tab") to prevent dual editing.
- **Persistence/Security of tokens:** access token kept **in memory only**; refresh via httpOnly cookie; nothing sensitive in localStorage. IndexedDB holds only the current attempt's own answers and scratchpad, wiped on submit ACK/logout.

---

## 11. Forms and Validation
- Zod schemas generated from/aligned with backend §14; same limits (e.g. title 3–200, duration 1–600, dispute reason 20–2000).
- Validate on blur + submit; announce errors via `aria-live`; focus first invalid field; preserve input on server errors; map server `details[].field` to field errors.
- Dates always entered in the user's timezone, displayed with timezone label, sent as UTC ISO.
- Destructive actions: confirmation dialog stating consequence; irreversible ones require typing the resource name.
- Unsaved-changes guard on wizards/editors.

---

## 12. Accessibility (WCAG 2.2 AA)
- Semantic landmarks, one `h1` per page, logical heading order, skip links.
- Full keyboard operation; visible 2 px focus ring with offset (indigo/vermilion on contrast); no keyboard traps (exam shortcuts are single-key only when focus isn't in a text field).
- Screen reader: live regions for timer thresholds, save status (polite), announcements (assertive only for force-submit/time extended); labelled icon buttons; table headers scoped; charts with `role="img"` + text alternative + data table.
- Targets ≥ 44 px; reflow at 320 px / 400 % zoom with no 2-D scrolling (except charts/tables with alternatives).
- Colour independence; contrast checked in CI via axe + token tests; reduced-motion, high-contrast, text-size, dyslexia-friendly font, and timer visibility options (§8.7).
- Time-limit considerations: exam timers are an essential exception, but approved accommodations (extra time) are displayed clearly to the candidate.
- Language attributes, RTL support through logical properties (`margin-inline`, etc.).

---

## 13. Responsiveness Matrix
| Area | ≥1280 | 768–1279 | <768 |
|---|---|---|---|
| Studio shell | Rail expanded + content + optional right drawer | Rail collapsed to icons | Bottom tab bar + sheet |
| Exam workspace | 3 columns (navigator · paper · margin) | Navigator collapsible left, margin below paper | Single column, bottom sheets for navigator/scratchpad |
| Tables | Full columns | Priority columns, others in row drawer | Record cards |
| Charts | Side-by-side | Stacked 2-col | Stacked 1-col, horizontally scrollable with sticky axes |
| Wizard | Rail + form + live summary | Rail top + form | Single step/screen, sticky action bar |
| Dialogs | Centered | Centered | Bottom sheet, drag to dismiss |
Test devices: 360×640, 390×844, 768×1024, 1024×768, 1440×900, 1920×1080; touch + mouse + keyboard.

---

## 14. Performance
- Targets: LCP < 2.5 s on 4G mid-range device, INP < 200 ms, CLS < 0.05; initial JS ≤ 180 KB gzip for login; route-level code splitting; the exam workspace chunk preloaded from the briefing page.
- Fonts: WOFF2 subsets, `font-display: swap`, preload display font only.
- Lists virtualized beyond 200 rows; memoized navigator cells; autosave debounced; SSE patches instead of refetch; images avoided (SVG only).
- Service worker caches the app shell and fonts (stale-while-revalidate); API responses are **not** cached by the SW (except the exam attempt payload kept in IndexedDB by the app itself, deliberately).
- Bundle budget enforced in CI (`size-limit`).

---

## 15. Security (frontend side)
- Strict CSP (`default-src 'self'`; no inline scripts; connect-src limited to the configured API origin), set via reverse proxy and meta fallback.
- Markdown/KaTeX content sanitized (`rehype-sanitize`), no `dangerouslySetInnerHTML` except through the sanitizing renderer.
- Tokens in memory; CSRF header on cookie-authed calls; logout clears Query cache, Zustand, IndexedDB attempt data.
- No secrets in the bundle; `config.json` contains only the public API URL.
- Candidate views never request fields they should not see; if an unexpected `isCorrect`/`explanation` ever appears in a candidate payload, the dev build throws and CI e2e fails (defensive contract test).
- Copy/paste/visibility events are reported to `/attempts/:id/events` (batched, throttled), carrying type + timestamp only — never content.
- Dependency audit + lockfile integrity in CI.

---

## 16. Integrity Signals (client behavior, privacy-first)
Collected only when `integrityLevel ≠ OFF` and only after acknowledgement: `visibilitychange`, `blur/focus` durations, fullscreen exits, copy/cut/paste (size category only), context menu, reconnects. Batched every 15 s or on `pagehide`. The candidate can open **"What's being recorded"** from the workspace menu at any time (list of event types, counts so far, and retention). Examiner UI always labels these as indicators.

---

## 17. Observability (client)
- Error boundary per route + global handler → `POST /client-errors` (rate-limited; includes route, build version, request ID, no PII/answers) if backend offers it; otherwise console only.
- Web Vitals reporting (optional endpoint) and feature-flagged debug panel (`?debug=1` for examiners/admins) showing connection state, queue length, clock offset, last request IDs.
- Build info (version, commit SHA) shown in settings footer and sent as `X-Client-Version`.

---

## 18. Environment & Build
| Item | Detail |
|---|---|
| Node | 20 LTS |
| Scripts | `dev`, `build`, `preview`, `lint`, `typecheck`, `test`, `test:e2e`, `api:types`, `size` |
| Config | `public/config.json` (runtime), `.env` (`VITE_API_BASE_URL` optional) |
| Docker | Multi-stage: build → Nginx static image with SPA fallback, `config.json` templated from `API_BASE_URL` env at container start, gzip/brotli, immutable caching for hashed assets, `no-store` for `index.html` and `config.json`, security headers |
| docker-compose | `web` service proxies `/api/` → `api:4000` so the default same-origin mode needs zero configuration — **bring up backend + frontend and they connect automatically** |
| CI | lint → typecheck → unit → build → e2e (Playwright against composed stack) → axe → Lighthouse → size budget |

---

## 19. Testing Strategy
- **Unit/component:** form validation, timer maths (offset, resync), save-queue ordering, connection state machine transitions, permission helpers, formatters.
- **MSW** is used in unit tests only and excluded from production builds by import-boundary lint rule.
- **E2E (Playwright, against real backend + seeded DB):** login per role; examiner creates exam from the UI; candidate completes attempt; refresh mid-exam keeps answers/time; **kill backend mid-exam → queue → restart backend → auto-reconnect and flush**; change device clock → timer unaffected; double-click submit; time-out auto-finalize; role-guard checks; import with errors; PDF download + public verify; dispute flow.
- **Auto-connect test:** start the frontend first, the backend 30 s later → Gate shows, then dismisses itself and the login appears without reload.
- **A11y:** axe on every route + manual screen-reader pass (NVDA/VoiceOver) on exam workspace.
- **Visual regression:** per breakpoint snapshots of key screens in both themes.

---

## 20. Hackathon Build Order (10 hours, UI parallel to backend)
| Hour | Deliverable |
|---|---|
| 0–1 | Vite/TS scaffold, tokens, fonts, primitives, ApiClient, **Connection Gate + state machine**, router guards |
| 1–2 | Login, session/refresh, shells (candidate, studio, admin) |
| 2–4 | Question bank, exam wizard, enrollments, publish checklist |
| 4–6.5 | Candidate dashboard, briefing, **exam workspace** (timer, autosave, offline queue, navigator, review/submit) |
| 6.5–7.5 | Monitor + announcements (SSE), grading queue, results publish |
| 7.5–8.5 | Analytics, PDF downloads, verify page, import center, sandbox, scratchpad, preferences |
| 8.5–9.5 | Disputes UI, fairness/resilience panels, polish, a11y/responsive pass |
| 9.5–10 | README, E2E smoke, deploy, demo rehearsal |
**Cut order if short:** admin system page → command palette → visual regression → Urdu/RTL → sketch tab (keep notes tab).

---

## 21. Acceptance Checklist
- [ ] Frontend starts before backend, shows Connection Gate, then connects automatically with no reload
- [ ] No hard-coded/dummy data anywhere in `src/` (grep lint rule for fixtures in non-test code)
- [ ] All three roles have complete, guarded experiences; 403/404 handled
- [ ] Exam workspace: server-timed, autosave with visible status, refresh-safe, offline queue, submit idempotent
- [ ] All 8 secondary features reachable from primary navigation/flows
- [ ] At least one (target three) innovation features have working UI panels
- [ ] Candidate payload contract test (no answer keys) passes
- [ ] Fully responsive 320 px → 2560 px; axe clean; keyboard-complete exam workspace
- [ ] Distinct Paper & Ink identity applied consistently in light, night, and high-contrast themes
- [ ] README: setup, env/config, test credentials, connection behavior, innovation description

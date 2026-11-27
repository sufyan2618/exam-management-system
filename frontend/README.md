# Secure Examination Management frontend

The frontend follows [FRONTEND_SPEC.md](FRONTEND_SPEC.md). It uses the repository's existing React, Vite and React Router setup, TanStack Query for API state, Zustand for session and workspace state, and IndexedDB for pending answers.

## Run locally

```sh
pnpm install
pnpm dev
pnpm build
pnpm lint
```

The Vite proxy forwards API calls to the backend on port 5000. Docker Compose serves the frontend and API through Nginx. The connection gate can start before the API and retries automatically. With no configuration, the app probes `/api/v1/health/ready` and falls back to the current backend's `/api/health`. Runtime `/config.json` takes priority over `VITE_API_BASE_URL` and the legacy `VITE_API_URL`. Set `apiBaseUrl` to the versioned API prefix for a separate deployment. The runtime file contains public configuration only.

Use users and examination records from the backend's seed or test environment. An authenticated account needs a server-provided `CANDIDATE`, `EXAMINER` or `ADMIN` role to open its workspace. The checked-in backend currently implements authentication and health; it has no role claims or examination data. The frontend retains support for its OTP account flows. See [API integration](API_INTEGRATION.md) for the additional contracts required to exercise the examination flows.

## Workspace flows

- **Candidate:** exam dashboard and briefing, readiness and start, answer navigation, save status and recovery, review and submission, results, PDF, public verification, disputes and display settings.
- **Examiner:** exam list and creation wizard, exam hub, question bank, enrollments and accommodations, live monitor and announcements, grading, results, reports, analytics, import validation and commit, sandbox and disputes.
- **Administrator:** platform status, users and roles, audit diffs, escalated disputes and job queues.

Exam time uses the server's remaining time and a monotonic display clock. Pending answers are keyed by account and attempt in IndexedDB. They replay in sequence after the server is reachable and the session epoch matches. Reopening an attempt requires a fresh server timer. The production service worker caches static files, and API requests are fetched from the server. Monitoring and notifications use event streams with polling fallback.

The frontend build and lint check can run without a backend. Verify authored exams, actual candidate submissions, backend-outage recovery, role access, imports, reports and disputes against the composed backend when the endpoints are ready. Accessibility auditing and the full frontend spec acceptance checklist remain separate from the production build.

# Secure Examination Management frontend

The frontend follows [FRONTEND_SPEC.md](FRONTEND_SPEC.md). It uses the repository's existing React, Vite and React Router setup, TanStack Query for API state, Zustand for session and workspace state, and IndexedDB for pending answers.

## Run locally

```sh
pnpm install
pnpm dev
pnpm build
pnpm lint
```

The Vite development server runs on port 5173 and forwards API calls to the Docker gateway at port 8088. For a backend running directly on the host, set `VITE_DEV_PROXY_TARGET=http://127.0.0.1:5000` in `.env.local`. Docker Compose serves the frontend and API through Nginx. The connection gate can start before the API and retries automatically. With no configuration, the app probes `/api/v1/health/ready` and falls back to the current backend's `/api/health`. Runtime `/config.json` takes priority over `VITE_API_BASE_URL` and the legacy `VITE_API_URL`. Set `apiBaseUrl` to the versioned API prefix for a separate deployment. The runtime file contains public configuration only.

Use users and examination records from the backend's seed or test environment. An authenticated account needs a server-provided `CANDIDATE`, `EXAMINER` or `ADMIN` role to open its workspace. The checked-in backend currently implements authentication and health; it has no role claims or examination data. The frontend retains support for its OTP account flows. See [API integration](API_INTEGRATION.md) for the additional contracts required to exercise the examination flows.

## Workspace flows

- **Candidate:** exam dashboard and briefing, readiness and start, answer navigation, save status and recovery, review and submission, results, PDF, public verification, disputes and display settings.
- **Examiner:** exam list and creation wizard, exam hub, question bank, enrollments and accommodations, live monitor and announcements, grading, results, reports, analytics, import validation and commit, sandbox and disputes.
- **Administrator:** platform status, users and roles, audit diffs, escalated disputes and job queues.

Exam time uses the server's remaining time and a monotonic display clock. Pending answers are keyed by account and attempt in IndexedDB. They replay in sequence after the server is reachable and the session epoch matches. Reopening an attempt requires a fresh server timer. The production service worker caches static files, and API requests are fetched from the server. Monitoring and notifications use event streams with polling fallback.

The frontend build and lint check can run without a backend. Verify authored exams, actual candidate submissions, backend-outage recovery, role access, imports, reports and disputes against the composed backend when the endpoints are ready. Accessibility auditing and the full frontend spec acceptance checklist remain separate from the production build.


## Local demo started by Codex

The composed demo runs at http://localhost:8088. Its generated development environment is stored outside the repository at `/tmp/exam-development.env`. Restart with `docker compose --env-file /tmp/exam-development.env up -d --build`. Keep that file to retain access to the current MongoDB volume.

Seeded accounts: `admin@demo.test` / `Admin#12345`, `examiner@demo.test` / `Examiner#12345`, and `candidate1@demo.test` / `Candidate#12345`. These are fictional local demonstration accounts.

The frontend uses runtime `/config.json`, then `VITE_API_BASE_URL`, then `/api/v1`. Development requests proxy through the Docker gateway on port 8088. Account creation is administered through Users or Candidate Imports; password recovery uses emailed reset links.


### Native dependency installation

Run `pnpm install` on the host for local Vite development. Do not install dependencies in an Alpine container with the host frontend directory mounted over `/app`: Ubuntu needs GNU native bindings, while Alpine needs musl bindings. The provided Dockerfile installs dependencies inside the image and keeps them separate from the host.


### Which frontend URL should I use?

- `http://localhost:5173`: run `pnpm run dev` to develop with live source updates. The API proxy targets `http://127.0.0.1:8088` by default.
- `http://localhost:8088`: the built frontend served by Docker/Nginx, alongside API routing. Source changes appear here after a Docker rebuild.
- Port `5000`: the backend HTTP port inside Docker, not published to the host. When running the backend directly on the host, override Vite's proxy target as described above.

The local demo uses `HTTP_PORT=8088` in `/tmp/exam-development.env`; Compose maps that host port to Nginx port 80. Both frontend URLs use the same Docker backend and database when the default development proxy is used.

# Verity Secure Examination Management

Verity is a web application for creating, delivering, monitoring, grading, and verifying online examinations. It provides separate examiner, candidate, and administrator workspaces, with assessment integrity signals designed to support human review without recording camera, microphone, screenshots, or keystroke content.

## What the application includes

- **Exam authoring:** reusable categorized question bank, single-choice, multiple-select, and written questions, rubrics, exam blueprint selection, preview/readiness checks, drafts, publishing, scheduling, and archiving.
- **Candidate administration:** candidate and examiner accounts, exam enrollment, accommodations, status management, and CSV/JSON import previews.
- **Exam delivery:** candidate instructions and notice acknowledgement, server-timed attempts, autosaved responses, review flags, announcements, and a private scratchpad.
- **Live monitoring:** attempt progress and connection state, examiner announcements, integrity timelines, interruption review, and audited time extensions or force submission.
- **Integrity and privacy:** limited advisory indicators such as tab visibility, fullscreen exit, clipboard actions, and reconnection. Indicators are not automatic misconduct findings.
- **Assessment and review:** automatic and written-response grading, rubrics, blind grading, moderation, regrading, answer-key overrides, and dispute workflows.
- **Results:** candidate and examiner result views, rankings, analytics, downloadable reports, QR verification, and a public result verification page.
- **Operations:** administrator user management, notifications, queue/health views, and append-only hash-chained audit logs.

## Architecture

| Part | Technology | Role |
| --- | --- | --- |
| `frontend/` | React, TypeScript, Vite | Examiner, candidate, and administrator browser application |
| `backend/` | Bun, TypeScript, Express, Mongoose | Versioned REST API, authentication, exam workflows, reports |
| MongoDB | MongoDB 7 replica set | Users and examination data; replica-set transactions are required |
| Redis | Redis 7 | Background jobs, live updates, throttling, and short-lived state |
| `backend/src/workers/` | BullMQ | Delayed submissions, imports, maintenance, analytics, and other background jobs |
| `nginx/`, `deploy/` | Nginx and Docker Compose | HTTPS edge proxy and container orchestration |

The root `docker-compose.yml` uses the root `.env` for deployment settings. Copy `.env.example` to `.env` and set strong application, database, JWT, and report-signing secrets before starting a deployment. Keep `.env` private.

## Start the application

From the repository root, configure `.env`, then build and start the services:

```sh
docker compose up -d --build
docker compose ps
```

The API readiness endpoint is `/api/v1/health/ready`. See [DEPLOY_EC2.md](DEPLOY_EC2.md) for the EC2 deployment setup.

For local development, install dependencies in `backend/` and `frontend/`, configure the backend environment, then run the backend API, worker, and Vite development server in separate terminals:

```sh
# Terminal 1: backend API
cd backend && bun install && bun run dev
```

```sh
# Terminal 2: background worker
cd backend && bun run dev:worker
```

```sh
# Terminal 3: frontend
cd frontend && pnpm install && pnpm dev
```

## Demo accounts

The demo reset creates fictional accounts using the reserved `demo.test` domain. All accounts in a role group share a password to make live demonstrations simple.

| Role | Login email | Default password |
| --- | --- | --- |
| Administrator | `admin@demo.test` | `ShowcaseAdmin#2026!` |
| Examiner | `examiner@demo.test` | `ShowcaseExaminer#2026!` |
| Co-examiner / reviewer | `reviewer@demo.test` | `ShowcaseExaminer#2026!` |
| Candidate | `candidate1@demo.test` through `candidate20@demo.test` | `ShowcaseCandidate#2026!` |
| Imported candidate | `mina.das@demo.test`, `tariq.ali@demo.test` | `ShowcaseCandidate#2026!` (temporary; change required at sign-in) |

Candidate accounts have realistic fictional names and registration numbers. The sample passwords are public demo credentials. Change them in the root `.env` before a public demonstration by setting `DEMO_ADMIN_PASSWORD`, `DEMO_EXAMINER_PASSWORD`, and `DEMO_CANDIDATE_PASSWORD`. Use a unique value of at least 14 characters for each variable. The seed writes those values as password hashes; they are not stored in MongoDB in plain text.

## Demo dataset

The reset script creates:

- 1 administrator, 2 examiners, 20 direct candidate accounts, and 2 imported candidate accounts.
- A question bank of 32 authored, explanatory questions across Computer Networks, Database Systems, Algorithms, and Information Security. The bank contains single-choice, multiple-select, and rubric-scored written items at multiple difficulty levels.
- A draft exam, a published exam scheduled 48 hours ahead, a live assessment with five active attempts, and a completed assessment with 20 graded and published results.
- Enrollment records, candidate accommodations, active attempt answers, answer timing, advisory integrity events, a network interruption, and a saved scratchpad.
- Live exam announcements, result verification codes, candidate notifications, a grading revision, and disputes in open, under-review, and escalated states.
- Candidate and question import previews to demonstrate validation errors and the import workflow.

The scheduled exam uses relative dates and will always be approximately two days in the future when the script runs. The live exam starts 20 minutes before the seed run and has an 80-minute availability window. Refresh the demo dataset before a presentation if it has aged out.

## Reset and seed demo data on the live Docker host

**This is a destructive reset.** It deletes all existing users, exams, questions, enrollments, attempts, answers, results, verification codes, disputes, imports, notifications, preferences, active sessions, and idempotency records in the configured MongoDB database. It clears the configured Redis database, including queues and temporary state. The append-only audit log is retained to preserve its hash chain. Back up the database first and confirm that `.env` points to the intended demo database.

Deploy/rebuild the version containing the demo seed, then run these commands from the directory containing `docker-compose.yml`:

```sh
docker compose build backend
docker compose stop backend worker
docker compose --profile seed run --rm seed bun src/scripts/seed.ts --confirm-reset
docker compose up -d backend worker
```

The API and worker are stopped during the reset so they cannot write to or process jobs for data being replaced. If the seed command fails, start the services again after inspecting the error:

```sh
docker compose up -d backend worker
```

The script checks that MongoDB has a writable primary, requires the Compose seed profile's `ALLOW_DEMO_SEED=true`, and refuses to run unless `--confirm-reset` is present. Do not remove either guard. The reset does not remove Docker volumes or container images.

You can replace the documented demo passwords by setting the three `DEMO_*_PASSWORD` variables in the root `.env` before the reset. The usernames remain the same. Keep `.env` out of source control.

## Useful commands

```sh
# Frontend production build
cd frontend && pnpm run build

# Backend static type check
cd backend && bun run typecheck

# Backend unit tests
cd backend && bun test

# View service logs
docker compose logs -f backend worker

# Check service status
docker compose ps
```

## Repository layout

```text
backend/src/controllers/   HTTP handlers
backend/src/models/        MongoDB schemas
backend/src/routers/       API routes and access rules
backend/src/schemas/       Request validation
backend/src/services/      Examination and business workflows
backend/src/scripts/       Seed and maintenance scripts
backend/src/workers/       Background queue consumers
frontend/src/api/          API client and DTO adapters
frontend/src/components/   Shared UI components
frontend/src/pages/        Role-specific screens
frontend/src/hooks/        Query, live update, and attempt hooks
deploy/                    Docker/Nginx deployment configuration
```

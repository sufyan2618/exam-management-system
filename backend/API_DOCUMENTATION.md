# API Documentation — Secure Examination Management System

Base URL (local): `http://localhost:5000`  
API prefix: `/api/v1`  
Interactive docs: `GET /api/docs` · OpenAPI JSON: `GET /api/docs.json`

## Envelopes

Success:
```json
{ "data": {}, "meta": { "page": 1, "pageSize": 20, "total": 0 } }
```

Error:
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Human readable message",
    "details": [{ "field": "body.email", "issue": "Invalid email address" }],
    "requestId": "uuid",
    "retryable": false
  }
}
```

Timed endpoints always include server clock fields (`serverTime`, `deadlineAt`, `remainingSeconds`). The client countdown must be derived from those — never from the device clock alone.

## Auth

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/auth/login` | public | argon2id; lockout after 5 fails / 15 min; returns access JWT |
| POST | `/auth/refresh` | public | refresh cookie at `/api/v1/auth`, requires `X-Requested-With` |
| POST | `/auth/logout` | public | CSRF header + cookie |
| POST | `/auth/forgot-password` | public | always 200 |
| POST | `/auth/reset-password` | public | |
| POST | `/auth/change-password` | any | allowed when `mustChangePassword` |
| GET | `/auth/me` | any | |

Access JWT claims: `sub`, `role`, `sid`, `ver` (tokenVersion). Refresh tokens are opaque, stored hashed, rotated; reuse of a family revokes the family.

Roles: `ADMIN`, `EXAMINER`, `CANDIDATE`. Foreign resources return **404** (not 403) so existence is not leaked.

## Users (admin)

`GET/POST /users`, `GET/PATCH /users/:id`, activate/deactivate, admin password reset, audit log listing.

## Question bank

Categories CRUD under `/categories`. Questions under `/questions` with versioning (edit of a used question forks a new version), sanitised Markdown stems, option validation, archive/duplicate, and `GET /questions/:id/analytics`.

## Exams

| Method | Path | Notes |
|---|---|---|
| POST/GET/PATCH/DELETE | `/exams`, `/exams/:id` | If-Match optimistic lock |
| PUT | `/exams/:id/questions` | ordered list + optional blueprint |
| POST | `/exams/:id/questions/auto-select` | quota pick from bank |
| GET | `/exams/:id/preview` | readiness checklist |
| POST | `/exams/:id/publish\|unpublish\|close\|archive` | atomic status transitions |
| * | `/exams/:id/enrollments` | enroll / accommodations / withdraw |
| * | `/exams/:id/announcements` | SSE + heartbeat delivery |

Exam `status` in responses is **computed** from the stored base state plus `startsAt`/`endsAt`/`closedAt`.

## Candidate delivery

| Method | Path | Notes |
|---|---|---|
| GET | `/me/exams`, `/me/exams/:examId` | available / upcoming / completed + access decision |
| POST | `/exams/:examId/attempts` | start or resume (idempotent) |
| GET | `/attempts/:id` | questions **without** keys / explanations / rubrics |
| PUT | `/attempts/:id/answers/:aqId` | autosave (`clientSeq`, rate-limited) |
| PUT | `/attempts/:id/answers:batch` | offline flush |
| POST | `/attempts/:id/flags\|heartbeat\|events\|submit\|notice-ack` | |
| GET/PUT | `/attempts/:id/scratchpad` | ≤ 100 KB, last-write-wins |
| GET | `/attempts/:id/stream` | SSE: announcements, time warnings (10/5/1), status |
| GET/PUT | `/me/preferences` | allow-listed workspace prefs |
| POST/DELETE | `/exams/:examId/sandbox/attempts` | examiner preview (isolated) |

Header `X-Session-Epoch` makes older sessions read-only after a resume on another device.

## Monitoring

`/exams/:id/monitor/summary|attempts|stream`, `/attempts/:id/monitor`, extend-time, force-submit, integrity-event review, interruption credit, `/me/notifications`.

Integrity payloads always include: *"Indicators for human review — not evidence of misconduct."*

## Grading & results

Written queue (blind by default), grade with 0.25 steps + revision history, regrade, key overrides (`ACCEPT_ALL_ANSWERS` / `ALTERNATE_KEY` / `VOID_QUESTION`), moderation offset, publish/unpublish results, `/me/results`, `/me/results/:attemptId`.

## Analytics & reports

Exam / question / candidate analytics (60 s Redis cache). PDF reports with QR + SHA-256 footer. CSV export (formula-injection safe). Public `GET /verify/:code` (masked name only).

## Imports

`POST /imports/candidates|questions` (multipart, dry-run default, atomic flag, 5 000-row cap), commit, `errors.csv`, one-time `credentials.csv` (Redis GETDEL), CSV templates.

## Disputes & fairness

Candidates: file within window (max 3 open), comment, withdraw. Examiners: review, escalate, resolve (four-eyes when re-scoring own grading), countersign. `GET /exams/:id/fairness` for paper difficulty cohort stats.

## Health

`GET /api/v1/health/live` · `GET /api/v1/health/ready` (Mongo + Redis + queue).

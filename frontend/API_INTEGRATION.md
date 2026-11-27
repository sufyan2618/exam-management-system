# Examination API integration

This file records the contracts consumed by the frontend. The repository's backend handover currently covers authentication and health. The examination types here are implementation assumptions based on the frontend specification and need to be reconciled with the backend's OpenAPI document when it is available.

## Base, authentication and responses

The versioned API uses the configured prefix (normally `/api/v1`) with routes such as `/health/ready`, `/auth/me`, and `/auth/refresh`. Existing deployments use `/api/health`, `/api/auth/profile` and `/api/auth/refresh-token`. Login provides an access token, and refresh uses the server cookie. API clients hold the access token in memory. The profile and login payloads supply the role and optional `mustChangePassword`.

JSON reads use a `{ data: ... }` envelope. List endpoints used by the common resource panel support an array or `{ items: [...] }` inside the envelope. Mutations accept JSON and return a data envelope or HTTP 204. Creation and start endpoints must return their new resource or attempt ID. Reports and templates return binary bodies. Import preview receives multipart form data with `file`, `type`, `mode` and `dryRun`. Error responses may carry `message`, `code`, `details` and `X-Request-Id`. Authorization is enforced by the server. The UI reads action flags such as `canStart`, `canGrade`, `canManage` and `canPublish` from responses.

## Workflow paths

Paths below are relative to the API prefix. The page code is the source of the field names sent and read by each adapter.

| Flow | Paths |
| --- | --- |
| Exam lookup and start | `GET /me/exams?bucket=`, `GET /exams/:id`, `POST /exams/:id/start` |
| Attempt | `GET /attempts/:id`, `PUT /attempts/:id/answers/:questionId`, `POST /attempts/:id/heartbeat`, `POST /attempts/:id/submit`, `PUT /attempts/:id/scratchpad`, `POST /attempts/:id/events`, `GET /attempts/:id/stream` |
| Candidate records | `/me/results`, `/me/results/:attemptId`, `/me/disputes`, `/me/disputes/:id`, `/me/disputes/:id/withdraw`, `PUT /me/preferences` |
| Authoring | `/exams`, `/exams/:id`, `/exams/:id/{preview,publish,archive,sandbox,questions,candidates}`, `/questions`, `/questions/:id` |
| Operations | `/exams/:id/{monitor,announcements,grading,results,analytics,disputes}`, `/exams/:id/monitor/stream`, `/attempts/:id/{extend,force-submit}`, `/disputes/:id/{resolve,escalate}` |
| Imports | `/imports`, `/imports/:id`, `/imports/:id/commit`, `/imports/templates/:type` |
| Reports and public verification | `/reports/results/:attemptId`, `/reports/exams/:id/{pdf,results.csv}`, `/verify/:code` |
| Admin | `/admin/{stats,users,audit,disputes,system}`, `/admin/users/:id`, `/admin/system/{queues,jobs}` |
| Shell | `/me/notifications`, `/me/notifications/stream`, `/me/notifications/:id/read`, `/search?q=` |

## Attempt rules

An active attempt response supplies `status: IN_PROGRESS`, `remainingSeconds`, `sessionEpoch`, last confirmed `clientSeq`, and the candidate-safe question list. Candidate question options contain only display text and identifiers. The browser sends `clientSeq` on saves; the backend must deduplicate retransmissions and reject stale epochs. Heartbeat and save responses can return the latest remaining time. Submission uses a stable idempotency key and the server records the receipt and final time. Result data and verification summaries are read directly from server responses.

The connection gate accepts a JSON readiness status of ready, healthy, ok, or degraded. Live endpoints send standard event-stream frames with IDs. The UI refreshes the corresponding data after events, and monitors retain polling while the stream is unavailable.


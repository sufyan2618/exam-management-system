export const ROLES = ["ADMIN", "EXAMINER", "CANDIDATE"] as const;
export type Role = (typeof ROLES)[number];

export const QUESTION_TYPES = ["MCQ_SINGLE", "MCQ_MULTI", "WRITTEN"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const BASE_DIFFICULTY_SCORE: Record<Difficulty, number> = { EASY: 0.3, MEDIUM: 0.5, HARD: 0.8 };

export const EXAM_STATUSES = ["DRAFT", "PUBLISHED", "ONGOING", "COMPLETED", "ARCHIVED"] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export const MULTI_SCHEMES = ["ALL_OR_NOTHING", "PARTIAL_PROPORTIONAL", "PARTIAL_PENALTY"] as const;
export type MultiScheme = (typeof MULTI_SCHEMES)[number];

export const INTEGRITY_LEVELS = ["OFF", "STANDARD", "STRICT"] as const;
export const FAIRNESS_MODES = ["OFF", "BALANCED"] as const;
export const ENROLLMENT_STATUSES = ["ENROLLED", "WITHDRAWN", "BLOCKED"] as const;

export const ATTEMPT_STATUSES = ["IN_PROGRESS", "SUBMITTED", "AUTO_SUBMITTED", "GRADING", "GRADED", "VOID"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];
export const FINALIZED_STATUSES: AttemptStatus[] = ["SUBMITTED", "AUTO_SUBMITTED", "GRADING", "GRADED"];
export const SUBMIT_REASONS = ["MANUAL", "TIMEOUT", "EXAMINER", "INTERRUPT_LIMIT"] as const;
export type SubmitReason = (typeof SUBMIT_REASONS)[number];
export const GRADING_STATES = ["PENDING", "PARTIAL", "COMPLETE"] as const;
export const GRADE_STATUSES = ["UNGRADED", "AUTO", "MANUAL", "REGRADED"] as const;

export const INTEGRITY_EVENT_TYPES = [
  "TAB_HIDDEN",
  "WINDOW_BLUR",
  "FULLSCREEN_EXIT",
  "COPY",
  "CUT",
  "PASTE",
  "CONTEXT_MENU",
  "MULTI_SESSION",
  "IP_CHANGE",
  "FAST_ANSWER",
  "PASTE_LARGE",
  "TYPING_ANOMALY",
  "RECONNECT",
  "SIMILARITY_WRITTEN",
  "SIMILARITY_WRONG_PATTERN",
] as const;
export type IntegrityEventType = (typeof INTEGRITY_EVENT_TYPES)[number];
/** Event types a client may report. Server-derived types are excluded. */
export const CLIENT_EVENT_TYPES = INTEGRITY_EVENT_TYPES.filter(
  (t) => !["MULTI_SESSION", "IP_CHANGE", "FAST_ANSWER", "SIMILARITY_WRITTEN", "SIMILARITY_WRONG_PATTERN"].includes(t),
) as unknown as readonly [IntegrityEventType, ...IntegrityEventType[]];
export const EVENT_SEVERITIES = ["INFO", "LOW", "MEDIUM"] as const;
export const REVIEW_STATUSES = ["OPEN", "REVIEWED", "DISMISSED", "CONFIRMED"] as const;

export const DISPUTE_TYPES = ["GRADING_ERROR", "AMBIGUOUS_QUESTION", "TECHNICAL_INCIDENT"] as const;
export const DISPUTE_STATUSES = [
  "OPEN",
  "UNDER_REVIEW",
  "RESOLVED_ACCEPTED",
  "RESOLVED_REJECTED",
  "ESCALATED",
  "WITHDRAWN",
] as const;
export const KEY_POLICIES = ["ACCEPT_ALL_ANSWERS", "ALTERNATE_KEY", "VOID_QUESTION"] as const;

export const HEARTBEAT_GAP_SECONDS = 30;
export const MAX_ANSWER_TEXT = 20_000;
export const MAX_SCRATCHPAD_BYTES = 100 * 1024;
export const MAX_PAGE_SIZE = 100;
export const CSV_ROW_CAP = 5000;
export const FAIRNESS_MAX_TRIES = 50;

export const DISPUTE_MAX_OPEN = 3;
export const DISPUTE_SLA_HOURS = 120;

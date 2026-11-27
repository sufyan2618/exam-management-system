import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import {
  ATTEMPT_STATUSES,
  EVENT_SEVERITIES,
  GRADE_STATUSES,
  GRADING_STATES,
  INTEGRITY_EVENT_TYPES,
  MULTI_SCHEMES,
  QUESTION_TYPES,
  REVIEW_STATUSES,
  SUBMIT_REASONS,
} from "../config/constants";

const attemptSchema = new Schema(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: "Enrollment" },
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    /** The candidate; for sandbox attempts this is the examiner who created it. */
    candidateId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    attemptNo: { type: Number, default: 1 },
    status: { type: String, enum: ATTEMPT_STATUSES, default: "IN_PROGRESS" },
    isSandbox: { type: Boolean, default: false },
    startedAt: { type: Date, required: true },
    deadlineAt: { type: Date, required: true },
    hardEndsAt: { type: Date },
    submittedAt: { type: Date },
    submitReason: { type: String, enum: SUBMIT_REASONS },
    paperSeed: { type: Number, required: true },
    paperDifficultyIndex: { type: Number },
    markingSnapshot: {
      type: new Schema(
        {
          multiSelectScheme: { type: String, enum: MULTI_SCHEMES, required: true },
          negativeMarking: { type: Number, required: true },
          totalMarks: { type: Number, required: true },
          passMarks: { type: Number },
        },
        { _id: false },
      ),
      required: true,
    },
    resilienceSnapshot: {
      type: new Schema(
        {
          mode: { type: String, default: "REVIEWED" },
          maxCreditSeconds: { type: Number, default: 300 },
          maxCredits: { type: Number, default: 3 },
          extendHardCap: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    noticeAckAt: { type: Date },
    sessionEpoch: { type: Number, default: 1 },
    lastSeenAt: { type: Date },
    lastAnswerAt: { type: Date },
    lastIp: { type: String },
    creditedSeconds: { type: Number, default: 0 },
    creditCount: { type: Number, default: 0 },
    extraSeconds: { type: Number, default: 0 },
    totalScore: { type: Number, default: 0 },
    gradingState: { type: String, enum: GRADING_STATES, default: "PENDING" },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);
attemptSchema.index(
  { enrollmentId: 1 },
  { unique: true, partialFilterExpression: { status: "IN_PROGRESS", isSandbox: false } },
);
attemptSchema.index(
  { enrollmentId: 1, attemptNo: 1 },
  { unique: true, partialFilterExpression: { enrollmentId: { $exists: true } } },
);
attemptSchema.index(
  { examId: 1, candidateId: 1 },
  { unique: true, partialFilterExpression: { status: "IN_PROGRESS", isSandbox: true } },
);
attemptSchema.index({ examId: 1, status: 1, isSandbox: 1 });
attemptSchema.index({ candidateId: 1 });
attemptSchema.index({ deadlineAt: 1 }, { partialFilterExpression: { status: "IN_PROGRESS" } });
attemptSchema.index({ isSandbox: 1, createdAt: 1 }, { partialFilterExpression: { isSandbox: true } });
export type AttemptAttrs = InferSchemaType<typeof attemptSchema>;
export type AttemptDoc = HydratedDocument<AttemptAttrs>;
export const Attempt = mongoose.model("Attempt", attemptSchema);

const attemptOptionSchema = new Schema({
  optionId: { type: Schema.Types.ObjectId, required: true },
  label: { type: String, required: true },
  text: { type: String, required: true },
  isCorrect: { type: Boolean, required: true },
  position: { type: Number, required: true },
});

const attemptQuestionSchema = new Schema(
  {
    attemptId: { type: Schema.Types.ObjectId, ref: "Attempt", required: true },
    examId: { type: Schema.Types.ObjectId, required: true },
    questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },
    questionVersion: { type: Number, default: 1 },
    position: { type: Number, required: true },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    stem: { type: String, required: true },
    marks: { type: Number, required: true },
    rubric: { type: String },
    explanation: { type: String },
    maxWords: { type: Number },
    section: { type: String, default: "" },
    difficultyScore: { type: Number },
    options: { type: [attemptOptionSchema], default: [] },
  },
  { timestamps: false },
);
attemptQuestionSchema.index({ attemptId: 1, position: 1 }, { unique: true });
attemptQuestionSchema.index({ examId: 1, questionId: 1 });
export type AttemptQuestionAttrs = InferSchemaType<typeof attemptQuestionSchema>;
export const AttemptQuestion = mongoose.model("AttemptQuestion", attemptQuestionSchema);

const answerSchema = new Schema(
  {
    attemptId: { type: Schema.Types.ObjectId, ref: "Attempt", required: true, index: true },
    attemptQuestionId: { type: Schema.Types.ObjectId, ref: "AttemptQuestion", required: true, unique: true },
    examId: { type: Schema.Types.ObjectId, required: true },
    candidateId: { type: Schema.Types.ObjectId, required: true },
    questionId: { type: Schema.Types.ObjectId, required: true },
    isSandbox: { type: Boolean, default: false },
    type: { type: String, enum: QUESTION_TYPES },
    selectedOptionIds: { type: [Schema.Types.ObjectId], default: [] },
    textAnswer: { type: String, maxlength: 20_000 },
    isMarkedForReview: { type: Boolean, default: false },
    clientSeq: { type: Number, default: 0 },
    savedAt: { type: Date },
    timeSpentSeconds: { type: Number },
    autoScore: { type: Number },
    manualScore: { type: Number },
    finalScore: { type: Number, default: null },
    gradeStatus: { type: String, enum: GRADE_STATUSES, default: "UNGRADED" },
    graderId: { type: Schema.Types.ObjectId },
    gradedAt: { type: Date },
    feedback: { type: String, maxlength: 2000 },
  },
  { timestamps: true },
);
answerSchema.index({ examId: 1, gradeStatus: 1, isSandbox: 1 });
export type AnswerAttrs = InferSchemaType<typeof answerSchema>;
export const Answer = mongoose.model("Answer", answerSchema);

const answerEventSchema = new Schema({
  attemptId: { type: Schema.Types.ObjectId, required: true, index: true },
  attemptQuestionId: { type: Schema.Types.ObjectId },
  clientSeq: { type: Number },
  payload: { type: Schema.Types.Mixed },
  receivedAt: { type: Date, default: Date.now },
  accepted: { type: Boolean, required: true },
  rejectReason: { type: String },
});
answerEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 400 });
export const AnswerEvent = mongoose.model("AnswerEvent", answerEventSchema);

const interruptionSchema = new Schema(
  {
    attemptId: { type: Schema.Types.ObjectId, required: true, index: true },
    examId: { type: Schema.Types.ObjectId, required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date },
    kind: { type: String, enum: ["NETWORK", "DEVICE", "POWER", "UNKNOWN"], default: "UNKNOWN" },
    gapSeconds: { type: Number, default: 0 },
    creditedSeconds: { type: Number, default: 0 },
    hadOfflineWrites: { type: Boolean, default: false },
    status: { type: String, enum: ["AUTO_RECORDED", "REVIEWED", "REJECTED"], default: "AUTO_RECORDED" },
    reviewerId: { type: Schema.Types.ObjectId },
    note: { type: String },
  },
  { timestamps: true },
);
interruptionSchema.index({ endedAt: 1, startedAt: 1 });
export type InterruptionAttrs = InferSchemaType<typeof interruptionSchema>;
export const Interruption = mongoose.model("Interruption", interruptionSchema);

const scratchpadSchema = new Schema(
  {
    attemptId: { type: Schema.Types.ObjectId, required: true, unique: true },
    content: { type: String, default: "" },
    strokes: { type: Schema.Types.Mixed },
    clientUpdatedAt: { type: Date },
  },
  { timestamps: true },
);
export const Scratchpad = mongoose.model("Scratchpad", scratchpadSchema);

const integrityEventSchema = new Schema({
  attemptId: { type: Schema.Types.ObjectId, required: true },
  examId: { type: Schema.Types.ObjectId, required: true, index: true },
  type: { type: String, enum: INTEGRITY_EVENT_TYPES, required: true },
  severity: { type: String, enum: EVENT_SEVERITIES, default: "INFO" },
  meta: { type: Schema.Types.Mixed },
  occurredAt: { type: Date, required: true },
  receivedAt: { type: Date, default: Date.now },
  reviewStatus: { type: String, enum: REVIEW_STATUSES, default: "OPEN" },
  reviewNote: { type: String, maxlength: 1000 },
  reviewerId: { type: Schema.Types.ObjectId },
  reviewedAt: { type: Date },
});
integrityEventSchema.index({ attemptId: 1, occurredAt: 1 });
integrityEventSchema.index({ receivedAt: 1 });
export type IntegrityEventAttrs = InferSchemaType<typeof integrityEventSchema>;
export const IntegrityEvent = mongoose.model("IntegrityEvent", integrityEventSchema);

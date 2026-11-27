import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import {
  DIFFICULTIES,
  ENROLLMENT_STATUSES,
  EXAM_STATUSES,
  FAIRNESS_MODES,
  INTEGRITY_LEVELS,
  KEY_POLICIES,
  MULTI_SCHEMES,
} from "../config/constants";

const examQuestionSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },
    questionVersion: { type: Number, default: 1 },
    position: { type: Number, required: true },
    marks: { type: Number, required: true, min: 0.25 },
    section: { type: String, default: "" },
  },
  { _id: false },
);

const blueprintSlotSchema = new Schema(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    difficulty: { type: String, enum: DIFFICULTIES, required: true },
    count: { type: Number, required: true, min: 1 },
    marksEach: { type: Number, required: true, min: 0.25 },
  },
  { _id: false },
);

const keyOverrideSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    policy: { type: String, enum: KEY_POLICIES, required: true },
    correctOptionIds: { type: [Schema.Types.ObjectId], default: [] },
    reason: { type: String, maxlength: 1000 },
    appliedBy: { type: Schema.Types.ObjectId },
    appliedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const examSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    coExaminerIds: { type: [Schema.Types.ObjectId], default: [], index: true },
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
    instructions: { type: String, default: "", maxlength: 10_000 },
    status: { type: String, enum: EXAM_STATUSES, default: "DRAFT", index: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    durationMinutes: { type: Number, required: true, min: 1, max: 600 },
    totalMarks: { type: Number, required: true, min: 0.25 },
    passMarks: { type: Number, min: 0 },
    shuffleQuestions: { type: Boolean, default: false },
    shuffleOptions: { type: Boolean, default: false },
    negativeMarking: { type: Number, default: 0, min: 0, max: 1 },
    multiSelectScheme: { type: String, enum: MULTI_SCHEMES, default: "ALL_OR_NOTHING" },
    maxAttempts: { type: Number, default: 1, min: 1, max: 10 },
    lateEntryMinutes: { type: Number, default: 15, min: 0 },
    hardWindow: { type: Boolean, default: true },
    flexibleStart: { type: Boolean, default: false },
    fairnessMode: { type: String, enum: FAIRNESS_MODES, default: "OFF" },
    fairnessEpsilon: { type: Number, default: 0.03 },
    showAnswersAfterPublish: { type: Boolean, default: false },
    integrityLevel: { type: String, enum: INTEGRITY_LEVELS, default: "STANDARD" },
    disputeWindowHours: { type: Number, default: 72 },
    resiliencePolicy: {
      mode: { type: String, enum: ["NONE", "GRACE", "REVIEWED"], default: "REVIEWED" },
      maxCreditSeconds: { type: Number, default: 300 },
      maxCredits: { type: Number, default: 3 },
      extendHardCap: { type: Boolean, default: false },
    },
    questions: { type: [examQuestionSchema], default: [] },
    blueprint: { type: [blueprintSlotSchema], default: [] },
    keyOverrides: { type: [keyOverrideSchema], default: [] },
    moderation: {
      mode: { type: String, enum: ["NONE", "ADDITIVE"], default: "NONE" },
      offset: { type: Number, default: 0 },
      note: { type: String },
      appliedBy: { type: Schema.Types.ObjectId },
      appliedAt: { type: Date },
    },
    announcementSeq: { type: Number, default: 0 },
    publishedAt: { type: Date },
    resultsPublishedAt: { type: Date },
    closedAt: { type: Date },
    version: { type: Number, default: 1 },
  },
  { timestamps: true, versionKey: false },
);
examSchema.index({ status: 1, startsAt: 1 });
examSchema.index({ title: "text" });
export type ExamAttrs = InferSchemaType<typeof examSchema>;
export type ExamDoc = HydratedDocument<ExamAttrs>;
export const Exam = mongoose.model("Exam", examSchema);

const enrollmentSchema = new Schema(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    candidateId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ENROLLMENT_STATUSES, default: "ENROLLED" },
    extraTimeMinutes: { type: Number, default: 0, min: 0, max: 600 },
    extraAttempts: { type: Number, default: 0, min: 0 },
    enrolledBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
enrollmentSchema.index({ examId: 1, candidateId: 1 }, { unique: true });
enrollmentSchema.index({ candidateId: 1, status: 1 });
export type EnrollmentAttrs = InferSchemaType<typeof enrollmentSchema>;
export const Enrollment = mongoose.model("Enrollment", enrollmentSchema);

const announcementSchema = new Schema(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    message: { type: String, required: true, maxlength: 500 },
    priority: { type: String, enum: ["NORMAL", "URGENT"], default: "NORMAL" },
    seq: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
announcementSchema.index({ examId: 1, seq: 1 }, { unique: true });
export const Announcement = mongoose.model("Announcement", announcementSchema);

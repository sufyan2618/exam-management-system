import mongoose, { Schema, type InferSchemaType } from "mongoose";

const resultSchema = new Schema(
  {
    attemptId: { type: Schema.Types.ObjectId, ref: "Attempt", required: true, unique: true },
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    candidateId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    rawScore: { type: Number, default: 0 },
    moderationOffset: { type: Number, default: 0 },
    totalScore: { type: Number, default: 0 },
    totalMarks: { type: Number, required: true },
    percentage: { type: Number, default: 0 },
    passed: { type: Boolean },
    gradeLabel: { type: String },
    rank: { type: Number },
    percentile: { type: Number },
    gradingComplete: { type: Boolean, default: false },
    isPublished: { type: Boolean, default: false },
    publishedAt: { type: Date },
    viewedAt: { type: Date },
    currentCode: { type: String },
    history: {
      type: [
        new Schema(
          { at: Date, oldScore: Number, newScore: Number, reason: String, code: String },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);
resultSchema.index({ examId: 1, isPublished: 1 });
resultSchema.index({ candidateId: 1, isPublished: 1 });
resultSchema.index({ currentCode: 1 }, { sparse: true });
export type ResultAttrs = InferSchemaType<typeof resultSchema>;
export const Result = mongoose.model("Result", resultSchema);

const verificationSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    resultId: { type: Schema.Types.ObjectId, required: true, index: true },
    attemptId: { type: Schema.Types.ObjectId, required: true },
    examId: { type: Schema.Types.ObjectId, required: true },
    candidateId: { type: Schema.Types.ObjectId, required: true },
    score: { type: Number, required: true },
    percentage: { type: Number, required: true },
    issuedAt: { type: Date, required: true },
    hash: { type: String, required: true },
    status: { type: String, enum: ["VALID", "REVOKED", "SUPERSEDED"], default: "VALID" },
    supersededByCode: { type: String },
  },
  { timestamps: true },
);
export const VerificationCode = mongoose.model("VerificationCode", verificationSchema);

const gradeRevisionSchema = new Schema(
  {
    answerId: { type: Schema.Types.ObjectId, required: true, index: true },
    attemptId: { type: Schema.Types.ObjectId, required: true },
    examId: { type: Schema.Types.ObjectId, required: true },
    oldScore: { type: Number, default: null },
    newScore: { type: Number, required: true },
    reason: { type: String, maxlength: 1000 },
    source: { type: String, enum: ["MANUAL", "REGRADE", "DISPUTE", "KEY_OVERRIDE"], required: true },
    changedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
export const GradeRevision = mongoose.model("GradeRevision", gradeRevisionSchema);

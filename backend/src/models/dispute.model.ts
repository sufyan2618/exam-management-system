import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { DISPUTE_STATUSES, DISPUTE_TYPES } from "../config/constants";

const disputeSchema = new Schema(
  {
    resultId: { type: Schema.Types.ObjectId, ref: "Result", required: true },
    attemptId: { type: Schema.Types.ObjectId, ref: "Attempt", required: true },
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    candidateId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: DISPUTE_TYPES, required: true },
    answerId: { type: Schema.Types.ObjectId },
    attemptQuestionId: { type: Schema.Types.ObjectId },
    interruptionId: { type: Schema.Types.ObjectId },
    reason: { type: String, required: true, minlength: 20, maxlength: 2000 },
    status: { type: String, enum: DISPUTE_STATUSES, default: "OPEN" },
    assigneeId: { type: Schema.Types.ObjectId },
    originalGraderId: { type: Schema.Types.ObjectId },
    resolution: {
      outcome: { type: String, enum: ["ACCEPT", "REJECT", "PARTIAL"] },
      newScore: { type: Number },
      oldScore: { type: Number },
      note: { type: String, maxlength: 2000 },
      policy: { type: String },
      allowReattempt: { type: Boolean },
      resolverId: { type: Schema.Types.ObjectId },
      countersignedBy: { type: Schema.Types.ObjectId },
      resolvedAt: { type: Date },
    },
    pendingResolution: { type: Schema.Types.Mixed },
    escalatedAt: { type: Date },
    slaDueAt: { type: Date, required: true },
  },
  { timestamps: true },
);
disputeSchema.index({ candidateId: 1, createdAt: -1 });
disputeSchema.index({ examId: 1, status: 1 });
disputeSchema.index({ status: 1, slaDueAt: 1 });
export type DisputeAttrs = InferSchemaType<typeof disputeSchema>;
export const Dispute = mongoose.model("Dispute", disputeSchema);

const disputeEventSchema = new Schema(
  {
    disputeId: { type: Schema.Types.ObjectId, required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, required: true },
    actorRole: { type: String },
    action: { type: String, required: true },
    note: { type: String, maxlength: 2000 },
    evidence: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
export const DisputeEvent = mongoose.model("DisputeEvent", disputeEventSchema);

import mongoose, { Schema } from "mongoose";

const auditLogSchema = new Schema(
  {
    seq: { type: Number, required: true, unique: true },
    actorId: { type: Schema.Types.ObjectId },
    actorRole: { type: String },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    meta: { type: Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
    requestId: { type: String },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });

// Append-only: reject every mutation path other than the initial insert.
const blocked = () => {
  throw new Error("audit_logs is append-only");
};
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"] as const) {
  auditLogSchema.pre(op as "updateOne", blocked);
}
auditLogSchema.pre("save", function (next) {
  if (!this.isNew) return next(new Error("audit_logs is append-only"));
  next();
});
export const AuditLog = mongoose.model("AuditLog", auditLogSchema);

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed },
    readAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
export const Notification = mongoose.model("Notification", notificationSchema);

const preferenceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, unique: true },
    workspace: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);
export const UserPreference = mongoose.model("UserPreference", preferenceSchema);

const importJobSchema = new Schema(
  {
    type: { type: String, enum: ["CANDIDATES", "QUESTIONS"], required: true },
    format: { type: String, enum: ["CSV", "JSON"], required: true },
    mode: { type: String, enum: ["DRY_RUN", "COMMIT"], required: true },
    status: {
      type: String,
      enum: ["PENDING", "VALIDATING", "PREVIEW", "APPLYING", "DONE", "FAILED"],
      default: "PENDING",
    },
    atomic: { type: Boolean, default: true },
    autoCreateCategories: { type: Boolean, default: false },
    examId: { type: Schema.Types.ObjectId },
    filePath: { type: String },
    totalRows: { type: Number, default: 0 },
    validRows: { type: Number, default: 0 },
    errorRows: { type: Number, default: 0 },
    appliedRows: { type: Number, default: 0 },
    rowErrors: { type: [new Schema({ row: Number, column: String, reason: String }, { _id: false })], default: [] },
    rows: { type: Schema.Types.Mixed, select: false },
    failureReason: { type: String },
    createdBy: { type: Schema.Types.ObjectId, required: true, index: true },
  },
  { timestamps: true, suppressReservedKeysWarning: true },
);
export const ImportJob = mongoose.model("ImportJob", importJobSchema);

const idempotencySchema = new Schema({
  keyHash: { type: String, required: true, unique: true },
  requestHash: { type: String, required: true },
  statusCode: { type: Number },
  body: { type: Schema.Types.Mixed },
  completed: { type: Boolean, default: false },
  expiresAt: { type: Date, required: true },
});
idempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const IdempotencyKey = mongoose.model("IdempotencyKey", idempotencySchema);

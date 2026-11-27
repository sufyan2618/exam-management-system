import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import { ROLES } from "../config/constants";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true },
    fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    role: { type: String, enum: ROLES, required: true, index: true },
    registrationNo: { type: String, trim: true, maxlength: 60 },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date },
    resetTokenHash: { type: String },
    resetTokenExpiry: { type: Date },
  },
  { timestamps: true },
);
userSchema.index({ registrationNo: 1 }, { unique: true, partialFilterExpression: { registrationNo: { $type: "string" } } });
userSchema.index({ resetTokenHash: 1 }, { sparse: true });
userSchema.index({ fullName: "text", email: "text" });

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = mongoose.model("User", userSchema);

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    refreshHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    userAgent: { type: String, maxlength: 300 },
    ip: { type: String },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model("Session", sessionSchema);

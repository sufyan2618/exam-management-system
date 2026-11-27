import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import { DIFFICULTIES, QUESTION_TYPES } from "../config/constants";

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    nameLower: { type: String, required: true },
    parentId: { type: Schema.Types.ObjectId, ref: "Category", default: null },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);
categorySchema.index({ ownerId: 1, nameLower: 1 }, { unique: true });
export type CategoryAttrs = InferSchemaType<typeof categorySchema>;
export const Category = mongoose.model("Category", categorySchema);

const optionSchema = new Schema(
  {
    label: { type: String, required: true },
    text: { type: String, required: true, maxlength: 1000 },
    isCorrect: { type: Boolean, required: true },
    position: { type: Number, required: true },
  },
  {},
);

const questionSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    stem: { type: String, required: true, maxlength: 10_000 },
    difficulty: { type: String, enum: DIFFICULTIES, required: true },
    difficultyScore: { type: Number, required: true, min: 0, max: 1 },
    calibrationCount: { type: Number, default: 0 },
    defaultMarks: { type: Number, required: true, min: 0.25 },
    explanation: { type: String, maxlength: 5000 },
    rubric: { type: String, maxlength: 5000 },
    maxWords: { type: Number, min: 1, max: 5000 },
    tags: { type: [String], default: [] },
    options: { type: [optionSchema], default: [] },
    version: { type: Number, default: 1 },
    rootId: { type: Schema.Types.ObjectId, index: true },
    isArchived: { type: Boolean, default: false },
    ambiguityFlag: { type: Boolean, default: false },
  },
  { timestamps: true },
);
questionSchema.index({ ownerId: 1, categoryId: 1, difficulty: 1 });
questionSchema.index({ tags: 1 });
questionSchema.index({ stem: "text" });

export type QuestionAttrs = InferSchemaType<typeof questionSchema>;
export type QuestionDoc = HydratedDocument<QuestionAttrs>;
export const Question = mongoose.model("Question", questionSchema);

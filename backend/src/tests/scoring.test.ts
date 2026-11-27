import { describe, expect, test } from "bun:test";
import { clamp, gradeLabel, isQuarterStep, round2, scoreObjective, sumScores } from "../lib/scoring";

const ids = ["a", "b", "c", "d"];

describe("scoreObjective", () => {
  test("MCQ_SINGLE: correct earns full marks", () => {
    expect(scoreObjective({ type: "MCQ_SINGLE", marks: 2, correctIds: ["b"], allOptionIds: ids, selectedIds: ["b"], scheme: "ALL_OR_NOTHING", negativeMarking: 0.25 })).toBe(2);
  });

  test("MCQ_SINGLE: wrong answer applies negative marking", () => {
    expect(scoreObjective({ type: "MCQ_SINGLE", marks: 2, correctIds: ["b"], allOptionIds: ids, selectedIds: ["a"], scheme: "ALL_OR_NOTHING", negativeMarking: 0.25 })).toBe(-0.5);
  });

  test("MCQ_SINGLE: blank scores 0", () => {
    expect(scoreObjective({ type: "MCQ_SINGLE", marks: 2, correctIds: ["b"], allOptionIds: ids, selectedIds: [], scheme: "ALL_OR_NOTHING", negativeMarking: 0.25 })).toBe(0);
  });

  test("MCQ_MULTI ALL_OR_NOTHING requires exact set", () => {
    const base = { type: "MCQ_MULTI" as const, marks: 4, correctIds: ["a", "c"], allOptionIds: ids, scheme: "ALL_OR_NOTHING" as const, negativeMarking: 0 };
    expect(scoreObjective({ ...base, selectedIds: ["a", "c"] })).toBe(4);
    expect(scoreObjective({ ...base, selectedIds: ["a"] })).toBe(0);
    expect(scoreObjective({ ...base, selectedIds: ["a", "c", "d"] })).toBe(0);
  });

  test("MCQ_MULTI PARTIAL_PROPORTIONAL", () => {
    const base = { type: "MCQ_MULTI" as const, marks: 4, correctIds: ["a", "c"], allOptionIds: ids, scheme: "PARTIAL_PROPORTIONAL" as const, negativeMarking: 0 };
    expect(scoreObjective({ ...base, selectedIds: ["a", "c"] })).toBe(4);
    expect(scoreObjective({ ...base, selectedIds: ["a"] })).toBe(2);
    expect(scoreObjective({ ...base, selectedIds: ["a", "b"] })).toBe(0);
  });

  test("MCQ_MULTI PARTIAL_PENALTY", () => {
    const base = { type: "MCQ_MULTI" as const, marks: 4, correctIds: ["a", "c"], allOptionIds: ids, scheme: "PARTIAL_PENALTY" as const, negativeMarking: 0 };
    // tp/c - fp/w = 1/2 - 1/2 = 0
    expect(scoreObjective({ ...base, selectedIds: ["a", "b"] })).toBe(0);
    expect(scoreObjective({ ...base, selectedIds: ["a", "c"] })).toBe(4);
  });
});

describe("score helpers", () => {
  test("sumScores uses integer cents", () => {
    expect(sumScores([0.1, 0.2, 0.3])).toBe(0.6);
    expect(sumScores([1.11, 2.22, null, undefined])).toBe(3.33);
  });
  test("round2 / clamp / quarter / gradeLabel", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(isQuarterStep(1.25)).toBe(true);
    expect(isQuarterStep(1.1)).toBe(false);
    expect(gradeLabel(91)).toBe("A+");
    expect(gradeLabel(45)).toBe("F");
  });
});

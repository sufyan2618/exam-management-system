import type { MultiScheme, QuestionType } from "../config/constants";

/** Round half away from zero to 2 decimals (decimal-safe for the magnitudes we deal with). */
export function round2(n: number) {
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * 100 + 1e-9)) / 100;
}

/** Sum using integer hundredths so totals never drift. */
export function sumScores(values: Array<number | null | undefined>) {
  let cents = 0;
  for (const v of values) if (typeof v === "number") cents += Math.round(v * 100);
  return cents / 100;
}

export const isQuarterStep = (n: number) => Math.abs(n * 4 - Math.round(n * 4)) < 1e-9;
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export interface ScoreInput {
  type: QuestionType;
  marks: number;
  correctIds: string[];
  allOptionIds: string[];
  selectedIds: string[];
  scheme: MultiScheme;
  negativeMarking: number;
}

/** Scores an objective answer. WRITTEN questions are never scored here. */
export function scoreObjective(input: ScoreInput): number {
  const { marks, negativeMarking } = input;
  const selected = [...new Set(input.selectedIds)];
  if (selected.length === 0) return 0;
  const correct = new Set(input.correctIds);
  const penalty = round2(marks * negativeMarking);

  if (input.type === "MCQ_SINGLE") {
    return selected.length === 1 && correct.has(selected[0] as string) ? round2(marks) : -penalty;
  }

  const tp = selected.filter((id) => correct.has(id)).length;
  const fp = selected.length - tp;
  const c = correct.size;
  const w = Math.max(0, input.allOptionIds.length - c);
  let score = 0;
  switch (input.scheme) {
    case "ALL_OR_NOTHING":
      score = tp === c && fp === 0 ? marks : 0;
      break;
    case "PARTIAL_PROPORTIONAL":
      score = c > 0 ? marks * Math.max(0, (tp - fp) / c) : 0;
      break;
    case "PARTIAL_PENALTY":
      score = c > 0 ? marks * Math.max(0, tp / c - (w > 0 ? fp / w : 0)) : 0;
      break;
  }
  score = round2(score);
  if (score === 0 && fp >= 1 && negativeMarking > 0) return -penalty;
  return score;
}

export function gradeLabel(percentage: number) {
  if (percentage >= 90) return "A+";
  if (percentage >= 80) return "A";
  if (percentage >= 70) return "B";
  if (percentage >= 60) return "C";
  if (percentage >= 50) return "D";
  return "F";
}

export function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
export function median(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}
export function stdev(values: number[]) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1));
}

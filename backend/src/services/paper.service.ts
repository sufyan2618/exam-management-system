import { BASE_DIFFICULTY_SCORE, FAIRNESS_MAX_TRIES } from "../config/constants";
import { hashString, seededRng, shuffle } from "../lib/shuffle";
import { round2 } from "../lib/scoring";

export interface PoolQuestion {
  _id: unknown;
  version: number;
  type: "MCQ_SINGLE" | "MCQ_MULTI" | "WRITTEN";
  categoryId: unknown;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  difficultyScore?: number | null;
  stem: string;
  rubric?: string | null;
  explanation?: string | null;
  maxWords?: number | null;
  options: Array<{ _id: unknown; text: string; isCorrect: boolean; position: number }>;
  marks: number;
  position: number;
  section: string;
}

export interface Slot {
  categoryId: unknown;
  difficulty: string;
  count: number;
  marksEach: number;
}

export interface BuiltItem {
  q: PoolQuestion;
  marks: number;
  section: string;
  options: Array<{ optionId: unknown; label: string; text: string; isCorrect: boolean; position: number }>;
}

const LABELS = "ABCDEFGHIJ";
const dOf = (q: PoolQuestion) => q.difficultyScore ?? BASE_DIFFICULTY_SCORE[q.difficulty];
const inSlot = (q: PoolQuestion, s: Slot) => String(q.categoryId) === String(s.categoryId) && q.difficulty === s.difficulty;

/** paper_difficulty_index = sum(marks_i * d_i) / sum(marks_i) */
export function difficultyIndex(items: Array<{ q: PoolQuestion; marks: number }>) {
  const total = items.reduce((a, i) => a + i.marks, 0);
  if (!total) return 0;
  return items.reduce((a, i) => a + i.marks * dOf(i.q), 0) / total;
}

/** Expected index of a randomly drawn paper (mean pool difficulty per slot, weighted by slot marks). */
export function targetIndex(pool: PoolQuestion[], blueprint: Slot[]) {
  let num = 0;
  let den = 0;
  for (const s of blueprint) {
    const p = pool.filter((q) => inSlot(q, s));
    if (!p.length) continue;
    const mean = p.reduce((a, q) => a + dOf(q), 0) / p.length;
    num += s.count * s.marksEach * mean;
    den += s.count * s.marksEach;
  }
  return den ? num / den : 0;
}

function draw(pool: PoolQuestion[], blueprint: Slot[], shuffleQuestions: boolean, seed: number): Array<{ q: PoolQuestion; marks: number; section: string }> {
  const rng = seededRng(seed);
  const byPosition = (a: PoolQuestion, b: PoolQuestion) => a.position - b.position;
  if (!blueprint.length) {
    const ordered = [...pool].sort(byPosition);
    return (shuffleQuestions ? shuffle(ordered, rng) : ordered).map((q) => ({ q, marks: q.marks, section: q.section }));
  }
  const items: Array<{ q: PoolQuestion; marks: number; section: string }> = [];
  blueprint.forEach((slot, si) => {
    let picks = shuffle(pool.filter((q) => inSlot(q, slot)), rng).slice(0, slot.count);
    if (!shuffleQuestions) picks = picks.sort(byPosition);
    for (const q of picks) items.push({ q, marks: slot.marksEach, section: String(si + 1) });
  });
  return items;
}

export interface PaperInput {
  pool: PoolQuestion[];
  blueprint: Slot[];
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  fairnessMode: "OFF" | "BALANCED";
  epsilon: number;
  seed: number;
}

/**
 * Builds one candidate's paper deterministically from `seed`.
 * BALANCED mode redraws (up to 50 times) until the paper's difficulty index is within epsilon of the
 * blueprint's expected index, falling back to the closest draw, so papers vary but stay comparable.
 */
export function buildPaper(input: PaperInput) {
  const target = targetIndex(input.pool, input.blueprint);
  let best = draw(input.pool, input.blueprint, input.shuffleQuestions, input.seed);
  let bestIdx = difficultyIndex(best);
  let tries = 1;
  if (input.fairnessMode === "BALANCED" && input.blueprint.length) {
    while (Math.abs(bestIdx - target) > input.epsilon && tries < FAIRNESS_MAX_TRIES) {
      const cand = draw(input.pool, input.blueprint, input.shuffleQuestions, input.seed + tries * 7919);
      const idx = difficultyIndex(cand);
      tries++;
      if (Math.abs(idx - target) < Math.abs(bestIdx - target)) {
        best = cand;
        bestIdx = idx;
      }
    }
  }

  const items: BuiltItem[] = best.map(({ q, marks, section }) => {
    let opts = [...q.options].sort((a, b) => a.position - b.position);
    if (input.shuffleOptions && q.type !== "WRITTEN") opts = shuffle(opts, seededRng(input.seed ^ hashString(String(q._id))));
    return {
      q,
      marks,
      section,
      options: opts.map((o, i) => ({ optionId: o._id, label: LABELS[i] as string, text: o.text, isCorrect: o.isCorrect, position: i })),
    };
  });
  return { items, difficultyIndex: round2(bestIdx * 10_000) / 10_000, targetIndex: target, tries };
}

import { describe, expect, test } from "bun:test";
import { Types } from "mongoose";
import { hmacSha256, normalizeCode, safeEqual, sha256 } from "../lib/crypto";
import { seededRng, shuffle } from "../lib/shuffle";
import { buildPaper, type PoolQuestion } from "../services/paper.service";
import { csvSafe } from "../lib/sanitize";

describe("shuffle determinism", () => {
  test("same seed yields same order", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffle(items, seededRng(42))).toEqual(shuffle(items, seededRng(42)));
    expect(shuffle(items, seededRng(1))).not.toEqual(shuffle(items, seededRng(2)));
  });
});

describe("fairness balancing", () => {
  const cat = new Types.ObjectId();
  const mk = (id: string, difficulty: "EASY" | "MEDIUM" | "HARD", score: number): PoolQuestion => ({
    _id: id,
    version: 1,
    type: "MCQ_SINGLE",
    categoryId: cat,
    difficulty,
    difficultyScore: score,
    stem: id,
    options: [
      { _id: `${id}-a`, text: "A", isCorrect: true, position: 0 },
      { _id: `${id}-b`, text: "B", isCorrect: false, position: 1 },
    ],
    marks: 1,
    position: Number(id.slice(1)),
    section: "1",
  });
  const pool = [
    mk("q1", "EASY", 0.2),
    mk("q2", "EASY", 0.25),
    mk("q3", "EASY", 0.3),
    mk("q4", "MEDIUM", 0.45),
    mk("q5", "MEDIUM", 0.5),
    mk("q6", "MEDIUM", 0.55),
    mk("q7", "HARD", 0.75),
    mk("q8", "HARD", 0.8),
    mk("q9", "HARD", 0.85),
  ];
  const blueprint = [
    { categoryId: cat, difficulty: "EASY", count: 1, marksEach: 1 },
    { categoryId: cat, difficulty: "MEDIUM", count: 1, marksEach: 1 },
    { categoryId: cat, difficulty: "HARD", count: 1, marksEach: 1 },
  ];

  test("BALANCED keeps difficulty index near the target", () => {
    const paper = buildPaper({ pool, blueprint, shuffleQuestions: true, shuffleOptions: true, fairnessMode: "BALANCED", epsilon: 0.03, seed: 99 });
    expect(Math.abs(paper.difficultyIndex - paper.targetIndex)).toBeLessThanOrEqual(0.05);
    expect(paper.tries).toBeGreaterThanOrEqual(1);
    expect(paper.tries).toBeLessThanOrEqual(50);
  });

  test("same seed reproduces the paper", () => {
    const a = buildPaper({ pool, blueprint, shuffleQuestions: true, shuffleOptions: true, fairnessMode: "BALANCED", epsilon: 0.03, seed: 7 });
    const b = buildPaper({ pool, blueprint, shuffleQuestions: true, shuffleOptions: true, fairnessMode: "BALANCED", epsilon: 0.03, seed: 7 });
    expect(a.items.map((i) => String(i.q._id))).toEqual(b.items.map((i) => String(i.q._id)));
    expect(a.difficultyIndex).toBe(b.difficultyIndex);
  });
});

describe("crypto + csv safety", () => {
  test("HMAC is deterministic and safeEqual rejects length mismatches", () => {
    expect(hmacSha256("secret", "payload")).toBe(hmacSha256("secret", "payload"));
    expect(safeEqual(sha256("a"), sha256("a"))).toBe(true);
    expect(safeEqual("aa", "a")).toBe(false);
  });
  test("normalizeCode strips separators", () => {
    expect(normalizeCode("ABCD-EFGH-IJKL-MNOP")).toBe("ABCDEFGHIJKLMNOP");
  });
  test("csvSafe neutralises formula injection", () => {
    expect(csvSafe("=CMD()")).toMatch(/^'/);
    expect(csvSafe("+1")).toMatch(/^'/);
  });
});

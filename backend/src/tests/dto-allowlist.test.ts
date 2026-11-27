import { describe, expect, test } from "bun:test";

describe("candidate DTO allow-list", () => {
  test("never exposes isCorrect, explanation or rubric", () => {
    const question = {
      attemptQuestionId: "x",
      position: 1,
      type: "MCQ_SINGLE",
      stem: "Q?",
      marks: 1,
      section: "1",
      maxWords: null,
      options: [{ label: "A", text: "yes" }, { label: "B", text: "no" }],
      answer: { selectedOptionIds: [], textAnswer: null, isMarkedForReview: false, clientSeq: 0, savedAt: null },
    };
    const leaked = JSON.stringify(question);
    expect(leaked).not.toContain("isCorrect");
    expect(leaked).not.toContain("explanation");
    expect(leaked).not.toContain("rubric");
    expect(leaked).not.toContain("optionId");
  });
});

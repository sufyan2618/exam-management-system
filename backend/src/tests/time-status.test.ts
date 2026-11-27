import { describe, expect, test } from "bun:test";
import { assertCanEnter, computeStatus, evaluateAccess } from "../lib/exam-status";
import { addMinutes, computeDeadline, remainingSeconds } from "../lib/time";

describe("computeDeadline", () => {
  test("honours hardEndsAt cap", () => {
    const startedAt = new Date("2026-01-01T10:00:00Z");
    const hard = new Date("2026-01-01T10:30:00Z");
    expect(computeDeadline({ startedAt, durationMinutes: 60, extraMinutes: 0, hardEndsAt: hard }).toISOString()).toBe(hard.toISOString());
    expect(computeDeadline({ startedAt, durationMinutes: 20, extraMinutes: 0, hardEndsAt: hard }).toISOString()).toBe(addMinutes(startedAt, 20).toISOString());
  });
  test("remainingSeconds never goes negative", () => {
    expect(remainingSeconds(new Date("2020-01-01"), new Date())).toBe(0);
  });
});

describe("exam status machine", () => {
  const base = { startsAt: new Date("2026-06-01T10:00:00Z"), endsAt: new Date("2026-06-01T12:00:00Z") };
  test("DRAFT and ARCHIVED stay put", () => {
    expect(computeStatus({ ...base, status: "DRAFT" }, new Date("2026-06-01T11:00:00Z"))).toBe("DRAFT");
    expect(computeStatus({ ...base, status: "ARCHIVED" }, new Date("2026-06-01T11:00:00Z"))).toBe("ARCHIVED");
  });
  test("time-derived PUBLISHED / ONGOING / COMPLETED", () => {
    expect(computeStatus({ ...base, status: "PUBLISHED" }, new Date("2026-06-01T09:00:00Z"))).toBe("PUBLISHED");
    expect(computeStatus({ ...base, status: "PUBLISHED" }, new Date("2026-06-01T11:00:00Z"))).toBe("ONGOING");
    expect(computeStatus({ ...base, status: "PUBLISHED" }, new Date("2026-06-01T13:00:00Z"))).toBe("COMPLETED");
  });
  test("closedAt forces COMPLETED", () => {
    expect(computeStatus({ ...base, status: "ONGOING", closedAt: new Date("2026-06-01T11:00:00Z") }, new Date("2026-06-01T11:05:00Z"))).toBe("COMPLETED");
  });
});

describe("evaluateAccess", () => {
  const exam = {
    status: "PUBLISHED",
    startsAt: new Date("2026-06-01T10:00:00Z"),
    endsAt: new Date("2026-06-01T12:00:00Z"),
    lateEntryMinutes: 15,
    flexibleStart: false,
    maxAttempts: 1,
  };
  test("blocks before open and after late entry", () => {
    expect(evaluateAccess(exam, { status: "ENROLLED" }, 0, new Date("2026-06-01T09:00:00Z")).code).toBe("EXAM_NOT_AVAILABLE");
    expect(evaluateAccess(exam, { status: "ENROLLED" }, 0, new Date("2026-06-01T10:20:00Z")).code).toBe("EXAM_WINDOW_CLOSED");
  });
  test("allows within window", () => {
    expect(evaluateAccess(exam, { status: "ENROLLED" }, 0, new Date("2026-06-01T10:05:00Z")).canEnter).toBe(true);
  });
  test("assertCanEnter throws AppError", () => {
    expect(() => assertCanEnter(exam, null, 0, new Date("2026-06-01T10:05:00Z"))).toThrow();
  });
});

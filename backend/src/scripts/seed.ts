/**
 * Demo seed for local / hackathon demos. Blocked in production unless ALLOW_DEMO_SEED=true.
 *
 * Credentials (all fictional):
 *   admin@demo.test      / Admin#12345
 *   examiner@demo.test   / Examiner#12345
 *   candidate1..20@demo.test / Candidate#12345
 */
import { Types } from "mongoose";
import { BASE_DIFFICULTY_SCORE } from "../config/constants";
import { env } from "../config/env";
import { connectDatabase, disconnectDatabase } from "../lib/db";
import { logger } from "../lib/logger";
import { Answer, Attempt, AttemptQuestion } from "../models/attempt.model";
import { Dispute, DisputeEvent } from "../models/dispute.model";
import { Announcement, Enrollment, Exam } from "../models/exam.model";
import { Category, Question } from "../models/question.model";
import { Result, VerificationCode } from "../models/result.model";
import { User } from "../models/user.model";
import { Notification, UserPreference } from "../models/system.model";
import { hashPassword } from "../utils/password";
import { buildOptions } from "../services/question.service";
import { issueVerification } from "../services/results.service";

if (env.IS_PROD && !env.ALLOW_DEMO_SEED) {
  console.error("Refusing to seed: NODE_ENV=production and ALLOW_DEMO_SEED is not true");
  process.exit(1);
}

const LABELS = "ABCDEFGHIJ";
const now = () => new Date();
const ago = (m: number) => new Date(Date.now() - m * 60_000);
const ahead = (m: number) => new Date(Date.now() + m * 60_000);

async function wipe() {
  await Promise.all([
    AttemptQuestion.deleteMany({}),
    Answer.deleteMany({}),
    Attempt.deleteMany({}),
    InterruptionSafe(),
    Result.deleteMany({}),
    VerificationCode.deleteMany({}),
    DisputeEvent.deleteMany({}),
    Dispute.deleteMany({}),
    Enrollment.deleteMany({}),
    Announcement.deleteMany({}),
    Exam.deleteMany({}),
    Question.deleteMany({}),
    Category.deleteMany({}),
    Notification.deleteMany({}),
    UserPreference.deleteMany({}),
    User.deleteMany({ email: /@demo\.test$/ }),
  ]);
}

async function InterruptionSafe() {
  const { IntegrityEvent, Interruption, Scratchpad, AnswerEvent } = await import("../models/attempt.model");
  await Promise.all([IntegrityEvent.deleteMany({}), Interruption.deleteMany({}), Scratchpad.deleteMany({}), AnswerEvent.deleteMany({})]);
}

function mcq(stem: string, correct: number, extras: string[] = ["Alpha", "Bravo", "Charlie", "Delta"]) {
  return extras.map((text, i) => ({ text, isCorrect: i === correct }));
}

async function seed() {
  await connectDatabase();
  logger.info("Seeding demo data…");
  await wipe();

  const adminHash = await hashPassword("Admin#12345");
  const examinerHash = await hashPassword("Examiner#12345");
  const candHash = await hashPassword("Candidate#12345");
  const [, examiner] = await User.insertMany([
    { email: "admin@demo.test", fullName: "Demo Admin", role: "ADMIN", passwordHash: adminHash, mustChangePassword: false },
    { email: "examiner@demo.test", fullName: "Demo Examiner", role: "EXAMINER", passwordHash: examinerHash, mustChangePassword: false },
    ...Array.from({ length: 20 }, (_, i) => ({
      email: `candidate${i + 1}@demo.test`,
      fullName: `Candidate ${i + 1}`,
      role: "CANDIDATE" as const,
      registrationNo: `REG-${String(i + 1).padStart(4, "0")}`,
      passwordHash: candHash,
      mustChangePassword: false,
    })),
  ]);
  const candDocs = await User.find({ email: /^candidate\d+@demo\.test$/ }).sort({ email: 1 });

  const catNames = ["Networks", "Databases", "Algorithms", "Security"];
  const cats = await Category.insertMany(catNames.map((name) => ({ name, nameLower: name.toLowerCase(), ownerId: examiner!._id })));

  const questions: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 60; i++) {
    const cat = cats[i % 4]!;
    const difficulty = (["EASY", "MEDIUM", "HARD"] as const)[i % 3]!;
    const type = i % 10 === 9 ? ("WRITTEN" as const) : i % 5 === 0 ? ("MCQ_MULTI" as const) : ("MCQ_SINGLE" as const);
    const stem =
      type === "WRITTEN"
        ? `Explain topic ${i + 1} in ${cat.name} with examples.`
        : type === "MCQ_MULTI"
          ? `Select all correct statements about ${cat.name} concept ${i + 1}.`
          : `Which statement about ${cat.name} concept ${i + 1} is correct?`;
    const options =
      type === "WRITTEN"
        ? []
        : type === "MCQ_MULTI"
          ? [
              { text: "Statement A (correct)", isCorrect: true },
              { text: "Statement B (correct)", isCorrect: true },
              { text: "Statement C", isCorrect: false },
              { text: "Statement D", isCorrect: false },
            ]
          : mcq(stem, i % 4);
    const _id = new Types.ObjectId();
    questions.push({
      _id,
      rootId: _id,
      ownerId: examiner!._id,
      categoryId: cat._id,
      type,
      stem,
      difficulty,
      difficultyScore: BASE_DIFFICULTY_SCORE[difficulty],
      defaultMarks: type === "WRITTEN" ? 5 : type === "MCQ_MULTI" ? 2 : 1,
      explanation: type === "WRITTEN" ? undefined : "Demo explanation.",
      rubric: type === "WRITTEN" ? "Award marks for clarity, correctness and examples." : undefined,
      maxWords: type === "WRITTEN" ? 250 : undefined,
      tags: [cat.name.toLowerCase(), difficulty.toLowerCase()],
      options: buildOptions(options),
      version: 1,
    });
  }
  await Question.insertMany(questions);
  const bank = await Question.find({ ownerId: examiner!._id }).sort({ createdAt: 1 });

  // DRAFT exam
  await Exam.create({
    ownerId: examiner!._id,
    title: "Demo Draft Exam",
    instructions: "This draft is not published.",
    status: "DRAFT",
    startsAt: ahead(60 * 24),
    endsAt: ahead(60 * 24 + 120),
    durationMinutes: 60,
    totalMarks: 20,
    passMarks: 10,
    questions: bank.slice(0, 10).map((q, i) => ({ questionId: q._id, version: 1, marks: q.defaultMarks, position: i + 1, section: "1" })),
  });

  // ONGOING exam (10 min window around now)
  const ongoingQs = bank.slice(10, 25);
  const ongoingTotal = ongoingQs.reduce((a, q) => a + q.defaultMarks, 0);
  const ongoing = await Exam.create({
    ownerId: examiner!._id,
    title: "Demo Ongoing Networks Quiz",
    instructions: "Answer all questions. Timer is server-authoritative.",
    status: "ONGOING",
    startsAt: ago(5),
    endsAt: ahead(55),
    durationMinutes: 10,
    lateEntryMinutes: 30,
    flexibleStart: true,
    maxAttempts: 1,
    totalMarks: ongoingTotal,
    passMarks: Math.ceil(ongoingTotal * 0.5),
    negativeMarking: 0.25,
    multiSelectScheme: "PARTIAL_PROPORTIONAL",
    shuffleQuestions: true,
    shuffleOptions: true,
    fairnessMode: "BALANCED",
    integrityLevel: "STANDARD",
    resiliencePolicy: { mode: "REVIEWED", maxCreditSeconds: 300, maxCredits: 3, extendHardCap: false },
    questions: ongoingQs.map((q, i) => ({ questionId: q._id, version: 1, marks: q.defaultMarks, position: i + 1, section: "1" })),
    publishedAt: ago(10),
  });
  await Enrollment.insertMany(candDocs.map((c) => ({ examId: ongoing._id, candidateId: c._id, status: "ENROLLED", enrolledBy: examiner!._id })));
  await Announcement.create({ examId: ongoing._id, seq: 1, message: "Welcome. Good luck!", authorId: examiner!._id });
  await Exam.updateOne({ _id: ongoing._id }, { $set: { announcementSeq: 1 } });

  // COMPLETED exam with published results
  const doneQs = bank.slice(25, 40);
  const doneTotal = doneQs.reduce((a, q) => a + q.defaultMarks, 0);
  const completed = await Exam.create({
    ownerId: examiner!._id,
    title: "Demo Completed Algorithms Exam",
    instructions: "Completed exam used for results / dispute demo.",
    status: "COMPLETED",
    startsAt: ago(60 * 24),
    endsAt: ago(60 * 22),
    closedAt: ago(60 * 22),
    durationMinutes: 45,
    totalMarks: doneTotal,
    passMarks: Math.ceil(doneTotal * 0.5),
    negativeMarking: 0,
    multiSelectScheme: "ALL_OR_NOTHING",
    showAnswersAfterPublish: true,
    disputeWindowHours: 72,
    questions: doneQs.map((q, i) => ({ questionId: q._id, version: 1, marks: q.defaultMarks, position: i + 1, section: "1" })),
    publishedAt: ago(60 * 26),
    resultsPublishedAt: ago(60),
  });
  await Enrollment.insertMany(candDocs.map((c) => ({ examId: completed._id, candidateId: c._id, status: "ENROLLED", enrolledBy: examiner!._id })));

  let openDispute: { id: string } | null = null;
  for (let i = 0; i < candDocs.length; i++) {
    const candidate = candDocs[i]!;
    const enrollment = await Enrollment.findOne({ examId: completed._id, candidateId: candidate._id });
    const startedAt = ago(60 * 23);
    const attempt = await Attempt.create({
      enrollmentId: enrollment!._id,
      examId: completed._id,
      candidateId: candidate._id,
      attemptNo: 1,
      status: "GRADED",
      startedAt,
      deadlineAt: new Date(startedAt.getTime() + 45 * 60_000),
      hardEndsAt: completed.endsAt,
      submittedAt: new Date(startedAt.getTime() + 30 * 60_000),
      submitReason: "MANUAL",
      paperSeed: 1000 + i,
      paperDifficultyIndex: 0.5,
      markingSnapshot: { multiSelectScheme: "ALL_OR_NOTHING", negativeMarking: 0, totalMarks: doneTotal, passMarks: completed.passMarks },
      resilienceSnapshot: { mode: "REVIEWED", maxCreditSeconds: 300, maxCredits: 3, extendHardCap: false },
      noticeAckAt: startedAt,
      gradingState: "COMPLETE",
      totalScore: 0,
    });
    const aqs = await AttemptQuestion.insertMany(
      doneQs.map((q, pos) => ({
        attemptId: attempt._id,
        examId: completed._id,
        questionId: q._id,
        questionVersion: 1,
        position: pos + 1,
        type: q.type,
        stem: q.stem,
        marks: q.defaultMarks,
        rubric: q.rubric,
        explanation: q.explanation,
        maxWords: q.maxWords,
        section: "1",
        difficultyScore: q.difficultyScore,
        options: q.options.map((o, oi) => ({ optionId: o._id, label: LABELS[oi]!, text: o.text, isCorrect: o.isCorrect, position: oi })),
      })),
    );
    let total = 0;
    for (const aq of aqs) {
      const opts = aq.options as unknown as Array<{ _id: Types.ObjectId; isCorrect: boolean }>;
      const correct = opts.filter((o) => o.isCorrect).map((o) => o._id);
      const pickCorrect = i % 3 !== 0; // ~2/3 score well
      const selected = aq.type === "WRITTEN" ? [] : pickCorrect ? correct : opts.slice(0, 1).map((o) => o._id);
      const score = aq.type === "WRITTEN" ? (pickCorrect ? aq.marks * 0.8 : aq.marks * 0.4) : pickCorrect ? aq.marks : 0;
      total += Math.round(score * 100) / 100;
      await Answer.create({
        attemptId: attempt._id,
        attemptQuestionId: aq._id,
        examId: completed._id,
        candidateId: candidate._id,
        questionId: aq.questionId,
        type: aq.type,
        selectedOptionIds: selected,
        textAnswer: aq.type === "WRITTEN" ? "Demo written answer covering the rubric points." : undefined,
        finalScore: Math.round(score * 100) / 100,
        autoScore: aq.type === "WRITTEN" ? undefined : Math.round(score * 100) / 100,
        manualScore: aq.type === "WRITTEN" ? Math.round(score * 100) / 100 : undefined,
        gradeStatus: aq.type === "WRITTEN" ? "MANUAL" : "AUTO",
        graderId: aq.type === "WRITTEN" ? examiner!._id : undefined,
        gradedAt: ago(90),
        clientSeq: 1,
        savedAt: startedAt,
      });
    }
    await Attempt.updateOne({ _id: attempt._id }, { $set: { totalScore: Math.round(total * 100) / 100 } });
    const percentage = doneTotal ? Math.round((total / doneTotal) * 10_000) / 100 : 0;
    const result = await Result.create({
      attemptId: attempt._id,
      examId: completed._id,
      candidateId: candidate._id,
      rawScore: Math.round(total * 100) / 100,
      totalScore: Math.round(total * 100) / 100,
      totalMarks: doneTotal,
      percentage,
      passed: total >= (completed.passMarks ?? 0),
      gradeLabel: percentage >= 70 ? "B" : percentage >= 50 ? "D" : "F",
      gradingComplete: true,
      isPublished: true,
      publishedAt: ago(60),
    });
    const code = await issueVerification({ _id: result._id, attemptId: result.attemptId, examId: result.examId, candidateId: result.candidateId, totalScore: result.totalScore, percentage: result.percentage });
    await Result.updateOne({ _id: result._id }, { $set: { currentCode: code } });

    if (i === 0) {
      const written = aqs.find((a) => a.type === "WRITTEN");
      const ans = written ? await Answer.findOne({ attemptQuestionId: written._id }) : null;
      const dispute = await Dispute.create({
        resultId: result._id,
        attemptId: attempt._id,
        examId: completed._id,
        candidateId: candidate._id,
        type: "GRADING_ERROR",
        answerId: ans?._id,
        attemptQuestionId: written?._id,
        reason: "I believe my written answer covers every rubric point and deserves a higher mark.",
        status: "OPEN",
        assigneeId: examiner!._id,
        originalGraderId: examiner!._id,
        slaDueAt: ahead(60 * 48),
      });
      await DisputeEvent.create({ disputeId: dispute._id, actorId: candidate._id, actorRole: "CANDIDATE", action: "CREATED", note: dispute.reason });
      openDispute = { id: String(dispute._id) };
    }
  }
  // ranks
  const { recomputeRanks } = await import("../services/results.service");
  await recomputeRanks(completed._id);

  logger.info("Seed complete", {
    admin: "admin@demo.test / Admin#12345",
    examiner: "examiner@demo.test / Examiner#12345",
    candidates: "candidate1..20@demo.test / Candidate#12345",
    exams: { draft: 1, ongoing: String(ongoing._id), completed: String(completed._id) },
    dispute: openDispute,
  });
  await disconnectDatabase();
}

seed().catch(async (err) => {
  console.error(err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});

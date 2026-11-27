import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { env } from "../config/env";
import { formatCode, sha256 } from "../lib/crypto";
import { round2 } from "../lib/scoring";
import { csvSafe } from "../lib/sanitize";
import { Answer, Attempt, AttemptQuestion } from "../models/attempt.model";
import { Exam } from "../models/exam.model";
import { Result } from "../models/result.model";
import { User } from "../models/user.model";
import { loadManagedExam } from "../policies/exam.policy";
import type { AuthUser } from "../types/express";
import { AppError, notFound } from "../utils/errors";
import { audit } from "./audit.service";
import { examAnalytics, questionAnalyticsForExam } from "./analytics.service";
import { loadAttemptForExaminer } from "./monitoring.service";

const fmt = (d?: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "-");

interface Section {
  heading: string;
  lines?: string[];
  table?: { columns: string[]; widths: number[]; rows: Array<Array<string | number>> };
}

interface ReportInput {
  title: string;
  subtitle: string;
  sections: Section[];
  code?: string | null;
  verifyUrl?: string | null;
}

/** Renders a report to a Buffer. The footer carries the verification code and a SHA-256 of the report content. */
async function renderPdf(input: ReportInput): Promise<{ buffer: Buffer; contentHash: string }> {
  const contentHash = sha256(JSON.stringify({ t: input.title, s: input.subtitle, sections: input.sections, code: input.code ?? null }));
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: input.title, Author: env.INSTITUTION_NAME, Producer: "Secure Exam Platform" }, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  doc.fontSize(9).fillColor("#666").text(env.INSTITUTION_NAME.toUpperCase());
  doc.moveDown(0.3).fontSize(20).fillColor("#111").text(input.title);
  doc.fontSize(10).fillColor("#444").text(input.subtitle).moveDown();

  for (const s of input.sections) {
    if (doc.y > 700) doc.addPage();
    doc.fontSize(13).fillColor("#111").text(s.heading).moveDown(0.3);
    doc.fontSize(9.5).fillColor("#222");
    for (const l of s.lines ?? []) doc.text(l);
    if (s.table) {
      const { columns, widths, rows } = s.table;
      const x0 = doc.page.margins.left;
      const drawRow = (cells: Array<string | number>, bold: boolean) => {
        if (doc.y > 760) doc.addPage();
        const y = doc.y;
        let x = x0;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
        let h = 12;
        cells.forEach((c, i) => {
          doc.text(String(c), x, y, { width: (widths[i] ?? 60) - 4, height: 24, ellipsis: true });
          x += widths[i] ?? 60;
          h = Math.max(h, 12);
        });
        doc.y = y + h + 2;
        doc.moveTo(x0, doc.y - 1).lineTo(x0 + widths.reduce((a, b) => a + b, 0), doc.y - 1).strokeColor("#ddd").lineWidth(0.5).stroke();
      };
      drawRow(columns, true);
      for (const r of rows) drawRow(r, false);
      doc.font("Helvetica");
    }
    doc.moveDown();
  }

  if (input.verifyUrl) {
    const png = await QRCode.toBuffer(input.verifyUrl, { margin: 1, width: 110 });
    if (doc.y > 650) doc.addPage();
    const y = doc.y + 6;
    doc.image(png, doc.page.margins.left, y, { width: 90 });
    doc.fontSize(9).fillColor("#222").text("Scan or visit to verify this document:", doc.page.margins.left + 105, y + 8);
    doc.fillColor("#0645ad").text(input.verifyUrl);
    doc.fillColor("#222").text(`Verification code: ${input.code ? formatCode(input.code) : "-"}`);
    doc.y = y + 100;
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.height - 36;
    doc.fontSize(7).fillColor("#777");
    doc.text(`Generated ${fmt(new Date())}  |  Code: ${input.code ? formatCode(input.code) : "n/a"}  |  SHA-256: ${contentHash}  |  Page ${i + 1}/${range.count}`, doc.page.margins.left, bottom, { width: doc.page.width - 96, lineBreak: false });
  }
  doc.end();
  return { buffer: await done, contentHash };
}

// ---- exam report ---------------------------------------------------------------------------------------------

export async function examReportPdf(user: AuthUser, examId: string) {
  const exam = await loadManagedExam(user, examId, "read");
  const [stats, q] = await Promise.all([examAnalytics(user, examId), questionAnalyticsForExam(user, examId)]);
  const { buffer, contentHash } = await renderPdf({
    title: `Exam report: ${exam.title}`,
    subtitle: `Window ${fmt(exam.startsAt)} to ${fmt(exam.endsAt)}  |  Duration ${exam.durationMinutes} min  |  Total marks ${exam.totalMarks}`,
    sections: [
      {
        heading: "Summary",
        lines: [
          `Enrolled: ${stats.enrolled}   Participants: ${stats.participants} (${stats.participationRate}%)   Attempts: ${stats.attempts}   Auto-submitted: ${stats.autoSubmitted}`,
          `Mean ${stats.score.mean}  Median ${stats.score.median}  Std dev ${stats.score.stdDev}  Min ${stats.score.min}  Max ${stats.score.max}`,
          `Pass rate: ${stats.passRate === null ? "n/a" : `${stats.passRate}%`}   Average duration: ${stats.averageDurationMinutes} min`,
        ],
      },
      { heading: "Score distribution", table: { columns: ["Range (%)", "Candidates"], widths: [160, 100], rows: stats.distribution.map((b) => [`${b.from} - ${Math.round(b.to)}`, b.count]) } },
      {
        heading: "Question analysis",
        lines: ["p = share earning full credit; D = discrimination (top vs bottom 27%). Flags need at least 30 responses."],
        table: {
          columns: ["#", "Question", "Type", "p", "D", "Omit", "Flags"],
          widths: [24, 220, 70, 40, 40, 44, 90],
          rows: q.questions.map((r: Record<string, any>, i: number) => [i + 1, String(r.stem ?? "").replace(/\s+/g, " "), r.type, r.pValue, r.discrimination ?? "-", r.omitRate, (r.flags ?? []).join(",")]),
        },
      },
    ],
  });
  await audit({ action: "report.exam", entityType: "exam", entityId: exam._id, meta: { contentHash } });
  return { buffer, filename: `exam-report-${examId}.pdf`, contentHash };
}

// ---- attempt report ------------------------------------------------------------------------------------------

async function attemptReport(attemptId: string, includeCode: boolean) {
  const attempt = await Attempt.findById(attemptId).lean();
  if (!attempt) throw notFound("Attempt");
  const [exam, candidate, result, aqs, answers] = await Promise.all([
    Exam.findById(attempt.examId).select("title").lean(),
    User.findById(attempt.candidateId).select("fullName registrationNo email").lean(),
    Result.findOne({ attemptId }).lean(),
    AttemptQuestion.find({ attemptId }).sort({ position: 1 }).select("position type marks stem").lean(),
    Answer.find({ attemptId }).select("attemptQuestionId finalScore gradeStatus").lean(),
  ]);
  const aMap = new Map(answers.map((a) => [String(a.attemptQuestionId), a]));
  const code = includeCode && result?.isPublished ? (result.currentCode ?? null) : null;
  const verifyUrl = code ? `${env.PUBLIC_VERIFY_BASE_URL}/${code}` : null;
  const { buffer, contentHash } = await renderPdf({
    title: `Result report: ${exam?.title ?? "Exam"}`,
    subtitle: `${candidate?.fullName ?? "-"}${candidate?.registrationNo ? `  |  ${candidate.registrationNo}` : ""}  |  Attempt ${attempt.attemptNo}  |  Submitted ${fmt(attempt.submittedAt)}`,
    code,
    verifyUrl,
    sections: [
      {
        heading: "Outcome",
        lines: result
          ? [
              `Score: ${result.totalScore} / ${result.totalMarks} (${result.percentage}%)   Grade: ${result.gradeLabel ?? "-"}   Rank: ${result.rank ?? "-"}   Result: ${result.passed === undefined || result.passed === null ? "-" : result.passed ? "PASS" : "FAIL"}`,
              ...(result.moderationOffset ? [`Includes a moderation adjustment of ${result.moderationOffset} marks applied to all candidates (raw score ${result.rawScore}).`] : []),
              ...(result.gradingComplete ? [] : ["Provisional: some answers are still awaiting grading."]),
              ...(result.isPublished || !includeCode ? [] : ["Not published: this document cannot be verified."]),
            ]
          : ["No result available."],
      },
      {
        heading: "Question breakdown",
        table: {
          columns: ["#", "Type", "Marks", "Score", "Status"],
          widths: [30, 100, 70, 70, 100],
          rows: aqs.map((aq) => {
            const a = aMap.get(String(aq._id));
            return [aq.position, aq.type, aq.marks, a?.finalScore ?? "-", a?.gradeStatus ?? "UNANSWERED"];
          }),
        },
      },
    ],
  });
  return { buffer, contentHash, filename: `result-${attemptId}.pdf`, examId: attempt.examId, total: round2(result?.totalScore ?? 0) };
}

export async function attemptReportForExaminer(user: AuthUser, attemptId: string) {
  await loadAttemptForExaminer(user, attemptId, false);
  const r = await attemptReport(attemptId, true);
  await audit({ action: "report.attempt", entityType: "attempt", entityId: attemptId, meta: { contentHash: r.contentHash } });
  return r;
}

export async function attemptReportForCandidate(user: AuthUser, attemptId: string) {
  const result = await Result.findOne({ attemptId, candidateId: user.userId, isPublished: true }).select("_id").lean();
  if (!result) throw new AppError(404, "RESULTS_NOT_PUBLISHED", "No published result found for this attempt");
  return attemptReport(attemptId, true);
}

// ---- CSV ------------------------------------------------------------------------------------------------------

export async function resultsCsv(user: AuthUser, examId: string) {
  const exam = await loadManagedExam(user, examId, "read");
  const results = await Result.find({ examId: exam._id }).sort({ rank: 1, totalScore: -1 }).lean();
  const [users, attempts] = await Promise.all([
    User.find({ _id: { $in: results.map((r) => r.candidateId) } }).select("fullName registrationNo email").lean(),
    Attempt.find({ _id: { $in: results.map((r) => r.attemptId) } }).select("attemptNo submittedAt submitReason").lean(),
  ]);
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  const aMap = new Map(attempts.map((a) => [String(a._id), a]));
  const header = ["Rank", "Name", "Registration No", "Email", "Attempt", "Raw score", "Moderation", "Final score", "Total marks", "Percentage", "Grade", "Passed", "Published", "Verification code", "Submitted at", "Submit reason"];
  const lines = [header.map(csvSafe).join(",")];
  for (const r of results) {
    const u = uMap.get(String(r.candidateId));
    const a = aMap.get(String(r.attemptId));
    lines.push(
      [r.rank ?? "", u?.fullName ?? "", u?.registrationNo ?? "", u?.email ?? "", a?.attemptNo ?? "", r.rawScore, r.moderationOffset, r.totalScore, r.totalMarks, r.percentage, r.gradeLabel ?? "", r.passed ?? "", r.isPublished, r.currentCode ? formatCode(r.currentCode) : "", a?.submittedAt?.toISOString() ?? "", a?.submitReason ?? ""]
        .map(csvSafe)
        .join(","),
    );
  }
  await audit({ action: "report.results_csv", entityType: "exam", entityId: exam._id, meta: { rows: results.length } });
  return { csv: "\uFEFF" + lines.join("\r\n") + "\r\n", filename: `results-${examId}.csv` };
}

/**
 * Destructive demo data reset. Requires both ALLOW_DEMO_SEED=true and --confirm-reset.
 *
 * Credentials (all fictional):
 *   admin@demo.test      / ShowcaseAdmin#2026!
 *   examiner@demo.test   / ShowcaseExaminer#2026!
 *   candidate1..20@demo.test / ShowcaseCandidate#2026!
 */
import mongoose, { Types } from "mongoose";
import { BASE_DIFFICULTY_SCORE, type Difficulty, type QuestionType } from "../config/constants";
import { env } from "../config/env";
import { connectDatabase, disconnectDatabase } from "../lib/db";
import { redis } from "../lib/redis";
import { logger } from "../lib/logger";
import { Answer, AnswerEvent, Attempt, AttemptQuestion, IntegrityEvent, Interruption, Scratchpad } from "../models/attempt.model";
import { Dispute, DisputeEvent } from "../models/dispute.model";
import { Announcement, Enrollment, Exam } from "../models/exam.model";
import { Category, Question } from "../models/question.model";
import { GradeRevision, Result, VerificationCode } from "../models/result.model";
import { Session, User } from "../models/user.model";
import { IdempotencyKey, ImportJob, Notification, UserPreference } from "../models/system.model";
import { hashPassword } from "../utils/password";
import { buildOptions } from "../services/question.service";
import { issueVerification } from "../services/results.service";
import { audit } from "../services/audit.service";
import { jobsQueue } from "../queues/jobs.queue";
import { emailQueue } from "../queues/email.queue";

if (!process.argv.includes("--confirm-reset")) {
  console.error("Refusing to reset data. Re-run with --confirm-reset after backing up the target database.");
  process.exit(1);
}
if (!env.ALLOW_DEMO_SEED) {
  console.error("Refusing to seed: ALLOW_DEMO_SEED must be true for this one-off reset command.");
  process.exit(1);
}

const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || "ShowcaseAdmin#2026!";
const EXAMINER_PASSWORD = process.env.DEMO_EXAMINER_PASSWORD || "ShowcaseExaminer#2026!";
const CANDIDATE_PASSWORD = process.env.DEMO_CANDIDATE_PASSWORD || "ShowcaseCandidate#2026!";
for (const [label, password] of [["DEMO_ADMIN_PASSWORD", ADMIN_PASSWORD], ["DEMO_EXAMINER_PASSWORD", EXAMINER_PASSWORD], ["DEMO_CANDIDATE_PASSWORD", CANDIDATE_PASSWORD]]) {
  if (password.length < 14 || password.length > 128) throw new Error(`${label} must be between 14 and 128 characters.`);
}

const LABELS = "ABCDEFGHIJ";
const ago = (m: number) => new Date(Date.now() - m * 60_000);
const ahead = (m: number) => new Date(Date.now() + m * 60_000);

type SeedQuestion = {
  category: string;
  difficulty: Difficulty;
  type: QuestionType;
  stem: string;
  marks: number;
  options?: { text: string; isCorrect: boolean }[];
  explanation?: string;
  rubric?: string;
  maxWords?: number;
  tags: string[];
};
const single = (category: string, difficulty: Difficulty, stem: string, correct: string, distractors: string[], explanation: string, marks = 1, tags: string[] = []): SeedQuestion => ({
  category, difficulty, type: "MCQ_SINGLE", stem, marks, explanation, tags: [category.toLowerCase(), ...tags],
  options: [correct, ...distractors].map((text, i) => ({ text, isCorrect: i === 0 })),
});
const multi = (category: string, difficulty: Difficulty, stem: string, correct: string[], distractors: string[], explanation: string, marks = 2, tags: string[] = []): SeedQuestion => ({
  category, difficulty, type: "MCQ_MULTI", stem, marks, explanation, tags: [category.toLowerCase(), ...tags],
  options: [...correct.map((text) => ({ text, isCorrect: true })), ...distractors.map((text) => ({ text, isCorrect: false }))],
});

// Curated assessment items use realistic scenarios and explain the intended answer.
const QUESTION_BANK: SeedQuestion[] = [
  single("Computer Networks", "EASY", "A small office needs a private IPv4 subnet that supports at least 25 devices. Which CIDR prefix provides enough usable host addresses with the least address waste?", "/27 (30 usable host addresses)", ["/28 (14 usable host addresses)", "/29 (6 usable host addresses)", "/30 (2 usable host addresses)"], "A /27 contains 32 addresses; after the network and broadcast addresses, 30 are usable."),
  single("Computer Networks", "EASY", "Which sequence correctly describes a standard DHCP lease negotiation?", "Discover, Offer, Request, Acknowledge", ["Request, Discover, Acknowledge, Offer", "Offer, Discover, Request, Acknowledge", "Discover, Request, Offer, Acknowledge"], "The client broadcasts Discover, the server sends Offer, the client selects with Request, and the server confirms with ACK."),
  single("Computer Networks", "MEDIUM", "A TCP client is establishing a connection with a server. Which packet sequence completes the three-way handshake?", "SYN, SYN-ACK, ACK", ["SYN, ACK, FIN", "ACK, SYN, SYN-ACK", "SYN-ACK, FIN, ACK"], "The initiator sends SYN, the server responds with SYN-ACK, and the initiator acknowledges with ACK."),
  single("Computer Networks", "MEDIUM", "A recursive DNS resolver has no cached answer for a domain. Which server is authoritative for the final record returned to the client?", "The domain's authoritative name server", ["The client's default gateway", "The nearest root server", "The DHCP server that assigned the client address"], "The resolver follows DNS delegation and obtains the requested record from the domain's authoritative name server."),
  single("Computer Networks", "HARD", "Two Ethernet devices communicate across a link with an MTU of 1,500 bytes. What is the main purpose of path MTU discovery?", "To find the largest packet that can cross the path without fragmentation", ["To select the shortest BGP route", "To negotiate a TCP receive window", "To assign a MAC address to each router"], "Path MTU discovery helps endpoints avoid packets that exceed the smallest MTU along the route."),
  multi("Computer Networks", "MEDIUM", "Which statements about network address translation (NAT) are correct?", ["It can translate private source addresses to a public address", "Port address translation can distinguish many internal connections using transport ports"], ["It encrypts application traffic end to end", "It replaces the need for routing between networks"], "NAT rewrites packet addressing; PAT also tracks transport ports. Neither operation inherently encrypts traffic."),
  single("Computer Networks", "HARD", "An OSPF router compares two routes to the same destination. Which route is preferred when all other factors are equal?", "The route with the lower OSPF cost", ["The route with the higher OSPF cost", "The route learned most recently", "The route with the numerically largest next-hop address"], "OSPF uses cost as its path metric and selects the lowest-cost route."),
  { category: "Computer Networks", difficulty: "MEDIUM", type: "WRITTEN", stem: "A branch office can reach its local gateway but cannot resolve hostnames. Describe two checks you would perform and explain what each result would tell you.", marks: 4, rubric: "Award up to 2 marks for relevant checks such as querying a known DNS resolver, inspecting resolver configuration, testing connectivity by IP, or checking DNS service health; award up to 2 marks for correctly interpreting outcomes.", maxWords: 180, tags: ["troubleshooting", "dns"] },

  single("Database Systems", "EASY", "A transfer must debit one account and credit another. Which ACID property ensures both changes happen together or neither does?", "Atomicity", ["Consistency", "Isolation", "Durability"], "Atomicity treats the transfer as one indivisible transaction."),
  single("Database Systems", "MEDIUM", "A relation stores a student's ID, course ID, student name, and course title. Student name depends only on student ID, while course title depends only on course ID. Which change best reduces update anomalies?", "Separate students and courses into related tables, with enrollment holding their IDs", ["Repeat the student name on every course row", "Store both names in one free-text column", "Remove the student and course identifiers"], "Separating entities removes partial dependencies and keeps each fact in one place."),
  single("Database Systems", "MEDIUM", "A database query filters millions of orders by customer_id. What is the most likely benefit of adding a suitable index on customer_id?", "Fewer rows need to be scanned to find matching orders", ["Every query becomes constant time", "The index removes the need to store the table", "Writes become faster because indexes require no maintenance"], "An index can reduce lookup work, but it consumes storage and adds work to inserts and updates."),
  single("Database Systems", "HARD", "A report transaction reads a row while another transaction updates it but has not committed. Which isolation anomaly occurs if the report sees that uncommitted value?", "Dirty read", ["Lost update", "Phantom read", "Write skew"], "A dirty read observes data that may later be rolled back."),
  single("Database Systems", "EASY", "A registration table must prevent the same student from registering twice for the same course. Which database constraint directly enforces that rule?", "A unique constraint on (student_id, course_id)", ["A non-unique index on course_id", "A check that student_id is not null", "A default value for registration_date"], "A composite unique constraint prevents duplicate student-course pairs at the database boundary."),
  multi("Database Systems", "MEDIUM", "Which practices help prevent SQL injection in an application?", ["Use parameterized queries for user-supplied values", "Use a database account with only the permissions the application needs"], ["Build SQL by concatenating escaped-looking strings", "Rely only on client-side input validation"], "Parameterized statements keep values separate from SQL syntax; least privilege limits damage if a flaw remains."),
  single("Database Systems", "HARD", "A service needs more read capacity but must keep one logical database and the same write authority. Which change is a read replica primarily intended to provide?", "Offload eligible reads to synchronized copies", ["Split each table's rows across independent shards", "Replace transaction logging with periodic exports", "Automatically partition a single table by column"], "Read replicas copy data from a primary and can serve reads; sharding partitions data across nodes."),
  { category: "Database Systems", difficulty: "MEDIUM", type: "WRITTEN", stem: "An API endpoint became slow after a table grew from 20,000 to 8 million rows. Explain how you would use a query plan and measured query data to decide whether an index is appropriate.", marks: 5, rubric: "Award marks for using EXPLAIN/ANALYZE or equivalent, checking scan type and rows examined, identifying filter/join/sort predicates, considering selectivity and write/storage costs, and validating with representative measurements.", maxWords: 220, tags: ["query-planning", "performance"] },

  single("Algorithms", "EASY", "A sorted array contains one million values. Approximately how many comparisons does binary search need in the worst case?", "About 20", ["About 1,000", "About 500,000", "About 1,000,000"], "Binary search halves the remaining interval each step; log2(1,000,000) is about 20."),
  single("Algorithms", "MEDIUM", "A graph has non-negative edge weights. Which algorithm is designed to find shortest paths from one source efficiently?", "Dijkstra's algorithm", ["Depth-first search", "Kruskal's algorithm", "Topological sorting"], "Dijkstra's algorithm handles non-negative edge weights; negative edges require a different approach."),
  single("Algorithms", "EASY", "In an unweighted graph, which traversal finds the minimum number of edges from a source to every reachable vertex?", "Breadth-first search", ["Depth-first search", "Quicksort", "Prim's algorithm"], "BFS explores vertices in increasing distance layers, giving shortest paths by edge count."),
  single("Algorithms", "MEDIUM", "Which statement about merge sort is correct for an array of n values?", "It is stable and runs in O(n log n) time", ["It is always in-place and runs in O(log n) time", "It is unstable and runs in O(n²) time", "It requires already sorted input"], "Standard merge sort is stable and has O(n log n) time, usually with O(n) auxiliary storage for arrays."),
  single("Algorithms", "MEDIUM", "Two different keys map to the same hash-table bucket. What is this situation called?", "A collision", ["A deadlock", "A cache invalidation", "A recurrence"], "A collision occurs when distinct keys produce the same table index or hash value."),
  single("Algorithms", "HARD", "A directed graph has a topological ordering. What must be true about the graph?", "It is a directed acyclic graph", ["It is a complete graph", "It is undirected and connected", "Every vertex has the same in-degree"], "A directed cycle makes a topological ordering impossible."),
  multi("Algorithms", "HARD", "Which problems are natural candidates for dynamic programming?", ["They have overlapping subproblems", "They have optimal substructure"], ["They require every input to be sorted first", "They have no repeated subproblems and no reusable state"], "Dynamic programming reuses solutions to overlapping subproblems and relies on optimal substructure."),
  { category: "Algorithms", difficulty: "MEDIUM", type: "WRITTEN", stem: "A team proposes replacing a linear search with a hash map for repeated lookups. State the expected lookup complexity, one important worst-case caveat, and one trade-off.", marks: 4, rubric: "Award 1 mark for expected O(1) lookup, 1 for collision/adversarial worst case (often O(n)), and up to 2 for a relevant trade-off such as memory overhead, hashing cost, ordering, or update characteristics.", maxWords: 160, tags: ["data-structures", "complexity"] },

  single("Information Security", "EASY", "Why should a password storage system use a unique random salt with a slow password-hashing function?", "To make precomputed attacks less reusable and increase the cost of guessing", ["To let the server recover the original password", "To encrypt the database connection", "To ensure all users have the same hash length"], "Unique salts defeat shared precomputed tables, while slow password hashing raises the cost of each guess."),
  single("Information Security", "MEDIUM", "A logged-in user is tricked into submitting an unwanted state-changing request from another site. Which control is specifically designed to mitigate this risk?", "A CSRF token validated by the server", ["A Content Security Policy alone", "A longer password", "A database index on the session table"], "A server-validated anti-CSRF token binds the state-changing request to the legitimate application session."),
  single("Information Security", "EASY", "A web application displays a comment written by a user. What is the primary defense against stored cross-site scripting?", "Context-aware output encoding of untrusted content", ["Store the comment in a database instead of memory", "Hide the comment with CSS", "Use HTTPS without changing rendering"], "Encoding at the output context prevents user content from being interpreted as executable markup or script."),
  single("Information Security", "EASY", "A support analyst needs to view ticket status but must not change user accounts. Which access-control principle should guide the analyst's permissions?", "Least privilege", ["Open access", "Security through obscurity", "Shared administrator credentials"], "Least privilege grants only the permissions necessary for the assigned task."),
  multi("Information Security", "MEDIUM", "Which pairs are distinct authentication factors in a multi-factor authentication flow?", ["A memorized passphrase and a hardware security key", "A password and a biometric characteristic"], ["A password and the same password typed twice", "Two different passwords stored in the same password manager"], "Factors should come from different categories such as knowledge, possession, and inherence."),
  single("Information Security", "HARD", "A browser connects to a service over TLS. Which certificate check is essential to help ensure it reached the intended service?", "Verify the certificate chain and that the hostname matches", ["Check only that the certificate file is not empty", "Accept any self-signed certificate without review", "Compare the certificate's file size with last week's"], "Trust-chain validation and hostname matching bind the certificate to the service the client intended to reach."),
  multi("Information Security", "MEDIUM", "Which practices improve an organization's ability to recover from ransomware?", ["Keep protected backups with tested restoration procedures", "Restrict backup administration and separate backup credentials"], ["Keep the only backup permanently mounted with write access", "Assume a successful backup job proves restoration will work"], "Protected, separated backups reduce attacker reach; restore tests verify that recovery actually works."),
  { category: "Information Security", difficulty: "HARD", type: "WRITTEN", stem: "A monitoring alert reports repeated failed logins followed by one successful login from an unfamiliar location. Outline the first response steps and name two kinds of evidence you would preserve.", marks: 5, rubric: "Award marks for verifying/triaging the alert, containing the account or sessions proportionately, contacting the user through a trusted channel, checking for persistence or lateral movement, and preserving authentication logs, timestamps, source addresses, device/session identifiers, or relevant endpoint evidence with chain-of-custody care.", maxWords: 220, tags: ["incident-response", "identity"] },
];

async function wipe() {
  await Promise.all([
    AttemptQuestion.deleteMany({}),
    Answer.deleteMany({}),
    Attempt.deleteMany({}),
    AnswerEvent.deleteMany({}),
    IntegrityEvent.deleteMany({}),
    Interruption.deleteMany({}),
    Scratchpad.deleteMany({}),
    Result.deleteMany({}),
    VerificationCode.deleteMany({}),
    GradeRevision.deleteMany({}),
    DisputeEvent.deleteMany({}),
    Dispute.deleteMany({}),
    Enrollment.deleteMany({}),
    Announcement.deleteMany({}),
    Exam.deleteMany({}),
    Question.deleteMany({}),
    Category.deleteMany({}),
    Notification.deleteMany({}),
    UserPreference.deleteMany({}),
    ImportJob.deleteMany({}),
    IdempotencyKey.deleteMany({}),
    Session.deleteMany({}),
    User.deleteMany({}),
  ]);
}

async function closeSeedResources() {
  await Promise.all([jobsQueue.close().catch(() => undefined), emailQueue.close().catch(() => undefined)]);
  redis.disconnect();
  await disconnectDatabase().catch(() => undefined);
  logger.end();
}

async function seed() {
  await connectDatabase();
  const topology = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!topology?.isWritablePrimary) {
    throw new Error("MongoDB has no writable primary. Seed stopped before deleting existing data.");
  }
  const adminHash = await hashPassword(ADMIN_PASSWORD);
  const examinerHash = await hashPassword(EXAMINER_PASSWORD);
  const candHash = await hashPassword(CANDIDATE_PASSWORD);
  console.warn(`DESTRUCTIVE RESET: replacing all user and examination data in MongoDB database "${mongoose.connection.name}" and clearing the configured Redis database.`);
  logger.info("Resetting database and seeding the complete demo workspace…");
  await Promise.all([jobsQueue.obliterate({ force: true }), emailQueue.obliterate({ force: true })]);
  await redis.flushdb();
  await wipe();

  const candidateNames = [
    "Amara Okafor", "Daniel Mercer", "Priya Nair", "Omar Hassan", "Elena Petrova",
    "Mateo Alvarez", "Zara Mahmood", "Noah Bennett", "Hana Kim", "Leo Fischer",
    "Aisha Rahman", "Samuel Okoye", "Maya Chen", "Idris Bello", "Sofia Rossi",
    "Ethan Brooks", "Nadia Farooq", "Lucas Pereira", "Fatima Zahra", "Arjun Mehta",
  ];
  const [admin, examiner, coExaminer] = await User.insertMany([
    { email: "admin@demo.test", fullName: "Jordan Ellis", role: "ADMIN", passwordHash: adminHash, mustChangePassword: false },
    { email: "examiner@demo.test", fullName: "Dr. Morgan Patel", role: "EXAMINER", passwordHash: examinerHash, mustChangePassword: false },
    { email: "reviewer@demo.test", fullName: "Prof. Avery Chen", role: "EXAMINER", passwordHash: examinerHash, mustChangePassword: false },
    ...candidateNames.map((fullName, i) => ({
      email: `candidate${i + 1}@demo.test`,
      fullName,
      role: "CANDIDATE" as const,
      registrationNo: `VX-${String(2026)}-${String(i + 1).padStart(4, "0")}`,
      passwordHash: candHash,
      mustChangePassword: false,
    })),
  ]);
  const candDocs = await User.find({ email: /^candidate\d+@demo\.test$/ }).sort({ email: 1 });
  candDocs.sort((a, b) => Number(a.email.match(/candidate(\d+)/)?.[1]) - Number(b.email.match(/candidate(\d+)/)?.[1]));
  await User.insertMany([
    { email: "mina.das@demo.test", fullName: "Mina Das", role: "CANDIDATE", registrationNo: "VX-2026-IMPORT-01", passwordHash: candHash, mustChangePassword: true },
    { email: "tariq.ali@demo.test", fullName: "Tariq Ali", role: "CANDIDATE", registrationNo: "VX-2026-IMPORT-02", passwordHash: candHash, mustChangePassword: true },
  ]);

  const catNames = ["Computer Networks", "Database Systems", "Algorithms", "Information Security"];
  const cats = await Category.insertMany(catNames.map((name) => ({ name, nameLower: name.toLowerCase(), ownerId: examiner!._id })));

  const categoryByName = new Map(cats.map((category) => [category.name, category]));
  const questions: Array<Record<string, unknown>> = QUESTION_BANK.map((item) => {
    const category = categoryByName.get(item.category)!;
    const _id = new Types.ObjectId();
    return {
      _id, rootId: _id, ownerId: examiner!._id, categoryId: category._id,
      type: item.type, stem: item.stem, difficulty: item.difficulty,
      difficultyScore: BASE_DIFFICULTY_SCORE[item.difficulty], defaultMarks: item.marks,
      explanation: item.explanation, rubric: item.rubric, maxWords: item.maxWords,
      tags: item.tags, options: buildOptions(item.options ?? []), version: 1,
    };
  });
  await Question.insertMany(questions);
  const bank = await Question.find({ ownerId: examiner!._id }).sort({ createdAt: 1 });

  // DRAFT exam
  const draftQuestions = bank.slice(0, 8);
  const draftTotal = draftQuestions.reduce((sum, question) => sum + question.defaultMarks, 0);
  await Exam.create({
    ownerId: examiner!._id,
    title: "Foundations of Computing — Spring 2027",
    instructions: "Draft assessment for the incoming term. Review the schedule, scoring, accessibility settings and question blueprint before publishing.",
    status: "DRAFT",
    startsAt: ahead(60 * 24 * 90),
    endsAt: ahead(60 * 24 * 90 + 120),
    durationMinutes: 60,
    totalMarks: draftTotal,
    passMarks: Math.ceil(draftTotal * 0.5),
    questions: draftQuestions.map((q, i) => ({ questionId: q._id, version: 1, marks: q.defaultMarks, position: i + 1, section: i < 4 ? "Networking fundamentals" : "Applied troubleshooting" })),
  });

  const scheduledQs = bank.slice(24, 32);
  const scheduledTotal = scheduledQs.reduce((a, q) => a + q.defaultMarks, 0);
  const scheduled = await Exam.create({
    ownerId: examiner!._id,
    coExaminerIds: [coExaminer!._id],
    title: "Secure Development & Data Protection — Midterm",
    instructions: "Read each item carefully. Written responses should explain the reasoning behind your recommendation. You may use the built-in scratchpad for private notes.",
    status: "PUBLISHED",
    startsAt: ahead(60 * 48),
    endsAt: ahead(60 * 50),
    durationMinutes: 75,
    totalMarks: scheduledTotal,
    passMarks: Math.ceil(scheduledTotal * 0.6),
    negativeMarking: 0,
    multiSelectScheme: "PARTIAL_PROPORTIONAL",
    shuffleQuestions: true,
    shuffleOptions: true,
    fairnessMode: "BALANCED",
    integrityLevel: "STANDARD",
    disputeWindowHours: 72,
    questions: scheduledQs.map((q, i) => ({ questionId: q._id, version: 1, marks: q.defaultMarks, position: i + 1, section: "Application security" })),
    publishedAt: ago(15),
  });
  await Enrollment.insertMany(candDocs.map((c, i) => ({
    examId: scheduled._id, candidateId: c._id, status: "ENROLLED", enrolledBy: examiner!._id,
    ...(i === 2 ? { extraTimeMinutes: 15 } : {}),
  })));

  // Active sessions make the candidate and examiner live-monitor screens useful immediately after reset.
  const ongoingQs = bank.slice(16, 28);
  const ongoingTotal = ongoingQs.reduce((a, q) => a + q.defaultMarks, 0);
  const ongoing = await Exam.create({
    ownerId: examiner!._id,
    coExaminerIds: [coExaminer!._id],
    title: "Secure Systems Certification — Live Assessment",
    instructions: "This proctored assessment covers network security, identity and incident response. Your timer is server-authoritative. Integrity indicators are limited, advisory signals and are reviewed by an examiner.",
    status: "ONGOING",
    startsAt: ago(20),
    endsAt: ahead(60 * 80),
    durationMinutes: 60,
    lateEntryMinutes: 10,
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
    questions: ongoingQs.map((q, i) => ({ questionId: q._id, version: 1, marks: q.defaultMarks, position: i + 1, section: i < 6 ? "Security operations" : "Secure application design" })),
    publishedAt: ago(25),
  });
  await Enrollment.insertMany(candDocs.map((c) => ({ examId: ongoing._id, candidateId: c._id, status: "ENROLLED", enrolledBy: examiner!._id })));
  await Announcement.insertMany([
    { examId: ongoing._id, seq: 1, message: "Welcome to the Secure Systems assessment. Check that your answers save before moving on, and contact the examiner through the approved support channel if you lose connectivity.", authorId: examiner!._id, priority: "NORMAL" },
    { examId: ongoing._id, seq: 2, message: "Reminder: the remaining time is shown in the exam header. Integrity indicators are advisory and are not automatic misconduct findings.", authorId: examiner!._id, priority: "NORMAL" },
  ]);
  await Exam.updateOne({ _id: ongoing._id }, { $set: { announcementSeq: 2 } });

  for (let i = 0; i < 5; i++) {
    const candidate = candDocs[i]!;
    const enrollment = await Enrollment.findOne({ examId: ongoing._id, candidateId: candidate._id });
    const startedAt = ago(18 - i * 3);
    const attempt = await Attempt.create({
      enrollmentId: enrollment!._id, examId: ongoing._id, candidateId: candidate._id,
      attemptNo: 1, status: "IN_PROGRESS", startedAt,
      deadlineAt: new Date(startedAt.getTime() + 60 * 60_000), hardEndsAt: ongoing.endsAt,
      paperSeed: 7200 + i, paperDifficultyIndex: 0.45 + i * 0.02,
      markingSnapshot: { multiSelectScheme: "PARTIAL_PROPORTIONAL", negativeMarking: 0.25, totalMarks: ongoingTotal, passMarks: ongoing.passMarks },
      resilienceSnapshot: { mode: "REVIEWED", maxCreditSeconds: 300, maxCredits: 3, extendHardCap: false },
      noticeAckAt: startedAt, lastSeenAt: new Date(Date.now() - (5 + i * 3) * 1000), gradingState: "PENDING",
      sessionEpoch: 1, lastAnswerAt: ago(2 + i),
    });
    const attemptQuestions = await AttemptQuestion.insertMany(ongoingQs.map((q, pos) => ({
      attemptId: attempt._id, examId: ongoing._id, questionId: q._id, questionVersion: 1,
      position: pos + 1, type: q.type, stem: q.stem, marks: q.defaultMarks,
      rubric: q.rubric, explanation: q.explanation, maxWords: q.maxWords,
      section: pos < 6 ? "Security operations" : "Secure application design",
      difficultyScore: q.difficultyScore,
      options: q.options.map((option, optionIndex) => ({ optionId: option._id, label: LABELS[optionIndex]!, text: option.text, isCorrect: option.isCorrect, position: optionIndex })),
    })));
    const answeredCount = Math.min(2 + i, 5);
    for (const [position, question] of attemptQuestions.slice(0, answeredCount).entries()) {
      const correct = question.options.filter((option) => option.isCorrect).map((option) => option._id);
      await Answer.create({
        attemptId: attempt._id, attemptQuestionId: question._id, examId: ongoing._id,
        candidateId: candidate._id, questionId: question.questionId, type: question.type,
        selectedOptionIds: question.type === "WRITTEN" ? [] : correct.map((id) => String(id)),
        textAnswer: question.type === "WRITTEN" ? "I would verify the alert, contain the account, and preserve authentication and endpoint logs for review." : undefined,
        clientSeq: position + 1, savedAt: ago(i + 2), timeSpentSeconds: 70 + position * 25,
      });
    }
    await Attempt.updateOne({ _id: attempt._id }, { $set: { lastAnswerAt: ago(i + 2) } });

    if (i === 0 || i === 1) {
      const eventTypes = i === 0 ? ["TAB_HIDDEN", "WINDOW_BLUR"] as const : ["PASTE", "FULLSCREEN_EXIT"] as const;
      await IntegrityEvent.insertMany(eventTypes.map((type, eventIndex) => ({
        attemptId: attempt._id, examId: ongoing._id, type,
        severity: type === "PASTE" ? "LOW" : type === "TAB_HIDDEN" || type === "FULLSCREEN_EXIT" ? "LOW" : "INFO",
        occurredAt: ago(8 - eventIndex), receivedAt: ago(8 - eventIndex), reviewStatus: "OPEN",
      })));
    }
    if (i === 2) {
      await Interruption.create({
        attemptId: attempt._id, examId: ongoing._id, startedAt: ago(9), endedAt: ago(6),
        kind: "NETWORK", gapSeconds: 142, creditedSeconds: 0, hadOfflineWrites: true,
        status: "AUTO_RECORDED", note: "Connectivity gap detected; examiner review pending.",
      });
    }
    if (i === 0) {
      await Scratchpad.create({
        attemptId: attempt._id,
        content: "Incident response notes\n1. Verify the alert and affected account.\n2. Revoke suspicious sessions and reset credentials.\n3. Preserve authentication logs and document the timeline.",
        clientUpdatedAt: ago(2),
      });
    }
  }

  // COMPLETED exam with published results
  const doneQs = bank.slice(0, 16);
  const doneTotal = doneQs.reduce((a, q) => a + q.defaultMarks, 0);
  const completed = await Exam.create({
    ownerId: examiner!._id,
    coExaminerIds: [coExaminer!._id],
    title: "Applied Computing Comprehensive — Results Published",
    instructions: "This completed assessment covers networking and database fundamentals. Published scores include a written response reviewed against a rubric. Candidates may raise a dispute during the published review window.",
    status: "COMPLETED",
    startsAt: ago(60 * 24),
    endsAt: ago(60 * 22),
    closedAt: ago(60 * 22),
    durationMinutes: 45,
    totalMarks: doneTotal,
    passMarks: Math.ceil(doneTotal * 0.5),
    negativeMarking: 0,
    multiSelectScheme: "ALL_OR_NOTHING",
    shuffleQuestions: true,
    shuffleOptions: true,
    fairnessMode: "BALANCED",
    integrityLevel: "STANDARD",
    showAnswersAfterPublish: true,
    disputeWindowHours: 72,
    moderation: { mode: "ADDITIVE", offset: 0.25, note: "Transparent +0.25-point cohort adjustment after item review.", appliedBy: examiner!._id, appliedAt: ago(60) },
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
      const pickCorrect = (i + aq.position) % 5 !== 0;
      const selected = aq.type === "WRITTEN" ? [] : pickCorrect ? correct : opts.filter((o) => !o.isCorrect).slice(0, 1).map((o) => o._id);
      const score = aq.type === "WRITTEN"
        ? Math.round(aq.marks * (pickCorrect ? 0.8 : 0.4) * 4) / 4
        : pickCorrect ? aq.marks : 0;
      total += Math.round(score * 100) / 100;
      await Answer.create({
        attemptId: attempt._id,
        attemptQuestionId: aq._id,
        examId: completed._id,
        candidateId: candidate._id,
        questionId: aq.questionId,
        type: aq.type,
        selectedOptionIds: selected,
        textAnswer: aq.type === "WRITTEN" ? "I would first verify the evidence and scope, then take a proportionate containment step. I would preserve timestamps, authentication records and relevant system logs, document each action, and validate the remediation before closing the incident." : undefined,
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
    const adjustedTotal = Math.round(Math.min(doneTotal, total + 0.25) * 100) / 100;
    const percentage = doneTotal ? Math.round((adjustedTotal / doneTotal) * 10_000) / 100 : 0;
    const result = await Result.create({
      attemptId: attempt._id,
      examId: completed._id,
      candidateId: candidate._id,
      rawScore: Math.round(total * 100) / 100,
      moderationOffset: Math.round((adjustedTotal - total) * 100) / 100,
      totalScore: adjustedTotal,
      totalMarks: doneTotal,
      percentage,
      passed: adjustedTotal >= (completed.passMarks ?? 0),
      gradeLabel: percentage >= 90 ? "A+" : percentage >= 80 ? "A" : percentage >= 70 ? "B" : percentage >= 60 ? "C" : percentage >= 50 ? "D" : "F",
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
        assigneeId: coExaminer!._id,
        originalGraderId: examiner!._id,
        slaDueAt: ahead(60 * 48),
      });
      await DisputeEvent.create({ disputeId: dispute._id, actorId: candidate._id, actorRole: "CANDIDATE", action: "CREATED", note: dispute.reason });
      await GradeRevision.create({
        answerId: ans!._id, attemptId: attempt._id, examId: completed._id,
        oldScore: Math.max(0, (ans!.finalScore ?? 0) - 1), newScore: ans!.finalScore ?? 0,
        reason: "Second-marker review against the published rubric.", source: "MANUAL", changedBy: examiner!._id,
      });
      openDispute = { id: String(dispute._id) };
    }
  }
  const candidateTwo = candDocs[1]!;
  const candidateThree = candDocs[2]!;
  const resultTwo = await Result.findOne({ examId: completed._id, candidateId: candidateTwo._id });
  const attemptTwo = await Attempt.findOne({ examId: completed._id, candidateId: candidateTwo._id });
  if (resultTwo && attemptTwo) {
    const reviewDispute = await Dispute.create({
      resultId: resultTwo._id, attemptId: attemptTwo._id, examId: completed._id,
      candidateId: candidateTwo._id, type: "TECHNICAL_INCIDENT",
      reason: "My connection dropped while I was saving the final written response. Please review the saved response and the recorded connection timeline.",
      status: "UNDER_REVIEW", assigneeId: examiner!._id, originalGraderId: examiner!._id,
      slaDueAt: ahead(60 * 60),
    });
    await DisputeEvent.insertMany([
      { disputeId: reviewDispute._id, actorId: candidateTwo._id, actorRole: "CANDIDATE", action: "CREATED", note: reviewDispute.reason },
      { disputeId: reviewDispute._id, actorId: examiner!._id, actorRole: "EXAMINER", action: "REVIEW_STARTED", note: "Reviewing the saved response and attempt timeline." },
    ]);
  }
  const resultThree = await Result.findOne({ examId: completed._id, candidateId: candidateThree._id });
  const attemptThree = await Attempt.findOne({ examId: completed._id, candidateId: candidateThree._id });
  if (resultThree && attemptThree) {
    const escalated = await Dispute.create({
      resultId: resultThree._id, attemptId: attemptThree._id, examId: completed._id,
      candidateId: candidateThree._id, type: "AMBIGUOUS_QUESTION",
      reason: "The wording of one question appears to support more than one defensible interpretation. Please review the answer key and question wording.",
      status: "ESCALATED", assigneeId: coExaminer!._id, originalGraderId: examiner!._id,
      escalatedAt: ago(30), slaDueAt: ahead(60 * 72),
    });
    await DisputeEvent.insertMany([
      { disputeId: escalated._id, actorId: candidateThree._id, actorRole: "CANDIDATE", action: "CREATED", note: escalated.reason },
      { disputeId: escalated._id, actorId: examiner!._id, actorRole: "EXAMINER", action: "ESCALATED", note: "Escalated for independent review of the answer key." },
    ]);
  }

  await UserPreference.create({ userId: candDocs[0]!._id, workspace: { theme: "light", fontScale: 1.1, layout: "split", navigatorPosition: "right", showTimer: true, reducedMotion: false, autoAdvance: false, colorBlindPalette: false, scratchpadDock: "bottom" } });
  await Notification.insertMany([
    { userId: candDocs[0]!._id, type: "result_published", payload: { examId: String(completed._id), examTitle: completed.title, message: "Your assessment result is available." } },
    { userId: candDocs[0]!._id, type: "dispute_update", payload: { examId: String(completed._id), message: "Your grading review case has been opened." } },
    { userId: examiner!._id, type: "dispute_opened", payload: { examId: String(completed._id), examTitle: completed.title, message: "A candidate requested a review." } },
  ]);
  const candidateImport = await ImportJob.create({
    type: "CANDIDATES", format: "CSV", mode: "COMMIT", status: "DONE", atomic: false,
    totalRows: 3, validRows: 2, errorRows: 1, appliedRows: 2,
    rowErrors: [{ row: 4, column: "email", reason: "An account with this email already exists" }],
    createdBy: admin!._id,
  });
  await redis.set(`import:creds:${String(candidateImport._id)}`, JSON.stringify([
    { email: "mina.das@demo.test", fullName: "Mina Das", registrationNo: "VX-2026-IMPORT-01", temporaryPassword: CANDIDATE_PASSWORD },
    { email: "tariq.ali@demo.test", fullName: "Tariq Ali", registrationNo: "VX-2026-IMPORT-02", temporaryPassword: CANDIDATE_PASSWORD },
  ]), "EX", 3600);
  await ImportJob.create({
      type: "QUESTIONS", format: "CSV", mode: "DRY_RUN", status: "PREVIEW", atomic: true,
      totalRows: 4, validRows: 3, errorRows: 1, appliedRows: 0,
      rowErrors: [{ row: 5, column: "correct", reason: "A single-choice question must have exactly one correct option" }],
      rows: { rows: [
        { rowNo: 2, category: "Information Security", input: { type: "MCQ_SINGLE", difficulty: "EASY", stem: "Which HTTP response header can help prevent a browser from embedding a page in an unauthorized frame?", defaultMarks: 1, explanation: "A frame-ancestors Content Security Policy directive controls permitted embedding origins.", options: [{ text: "Content-Security-Policy with frame-ancestors", isCorrect: true }, { text: "Accept-Language", isCorrect: false }, { text: "ETag", isCorrect: false }, { text: "Content-Length", isCorrect: false }], tags: ["web-security", "headers"], categoryId: String(cats[3]!._id) } },
        { rowNo: 3, category: "Database Systems", input: { type: "MCQ_SINGLE", difficulty: "MEDIUM", stem: "Which SQL clause filters groups after aggregate values have been calculated?", defaultMarks: 1, explanation: "HAVING filters grouped results after aggregation; WHERE filters input rows before grouping.", options: [{ text: "HAVING", isCorrect: true }, { text: "WHERE", isCorrect: false }, { text: "ORDER BY", isCorrect: false }, { text: "LIMIT", isCorrect: false }], tags: ["sql", "aggregation"], categoryId: String(cats[1]!._id) } },
        { rowNo: 4, category: "Algorithms", input: { type: "MCQ_SINGLE", difficulty: "EASY", stem: "Which data structure follows first-in, first-out ordering?", defaultMarks: 1, explanation: "A queue removes items in the same order they were inserted.", options: [{ text: "Queue", isCorrect: true }, { text: "Stack", isCorrect: false }, { text: "Binary search tree", isCorrect: false }, { text: "Heap", isCorrect: false }], tags: ["data-structures"], categoryId: String(cats[2]!._id) } },
      ], newCategories: [] },
      createdBy: examiner!._id,
    });
  await Attempt.updateMany({ examId: ongoing._id, status: "IN_PROGRESS" }, { $set: { lastSeenAt: new Date() } });
  // ranks
  const { recomputeRanks } = await import("../services/results.service");
  await recomputeRanks(completed._id);
  await audit({ action: "demo.seed.complete", entityType: "workspace", entityId: completed._id, actor: { userId: String(admin!._id), role: "ADMIN" }, after: { users: 25, questionBank: QUESTION_BANK.length, exams: 4, publishedResults: candDocs.length } });
  await audit({ action: "exam.publish", entityType: "exam", entityId: scheduled._id, actor: { userId: String(examiner!._id), role: "EXAMINER" }, after: { title: scheduled.title, startsAt: scheduled.startsAt, enrolled: candDocs.length } });
  await audit({ action: "exam.announcement.create", entityType: "exam", entityId: ongoing._id, actor: { userId: String(examiner!._id), role: "EXAMINER" }, after: { announcements: 2 } });
  await audit({ action: "results.publish", entityType: "exam", entityId: completed._id, actor: { userId: String(examiner!._id), role: "EXAMINER" }, after: { publishedResults: candDocs.length, verificationCodes: candDocs.length } });

  logger.info("Seed complete", {
    admin: `admin@demo.test / ${ADMIN_PASSWORD}`,
    examiner: `examiner@demo.test and reviewer@demo.test / ${EXAMINER_PASSWORD}`,
    candidates: `candidate1..${candDocs.length}@demo.test / ${CANDIDATE_PASSWORD}`,
    exams: { draft: 1, scheduled: String(scheduled._id), ongoing: String(ongoing._id), completed: String(completed._id) },
    dispute: openDispute,
  });
  await closeSeedResources();
}

seed().catch(async (err) => {
  console.error(err);
  await closeSeedResources();
  process.exitCode = 1;
});

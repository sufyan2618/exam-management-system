import type { Role } from "../types/auth";

export type Screen = { path: string; title: string; nav?: boolean; exam?: boolean };
export type Workspace = { role: Role; label: string; screens: Screen[] };

export const examTabs = [
  ["overview", "Overview", "Exam details"],
  ["questions", "Questions", "This exam's questions"],
  ["candidates", "Candidates", "Enrollments and accommodations"],
  ["announcements", "Announcements", "Send updates to enrolled candidates"],
  ["monitor", "Monitor", "Live attempt activity and integrity indicators"],
  ["grading", "Grading", "The grading queue"],
  ["results", "Results", "Result publishing and reports"],
  ["analytics", "Analytics", "Exam analytics and fairness indicators"],
  ["disputes", "Disputes", "Disputes for this exam"],
  ["settings", "Settings", "Exam settings"],
] as const;

export const workspaces: Workspace[] = [
  {
    role: "CANDIDATE",
    label: "Candidate workspace",
    screens: [
      { path: "/app", title: "Examinations", nav: true },
      { path: "/app/exams", title: "Examinations" },
      { path: "/app/exams/:examId", title: "Exam briefing" },
      { path: "/app/attempt/:attemptId", title: "Exam workspace", exam: true },
      { path: "/app/attempt/:attemptId/review", title: "Review your answers", exam: true },
      { path: "/app/results", title: "My results", nav: true },
      { path: "/app/results/:attemptId", title: "Result details" },
      { path: "/app/disputes", title: "My disputes", nav: true },
      { path: "/app/disputes/:id", title: "Dispute details" },
      { path: "/app/settings", title: "Workspace preferences", nav: true },
    ],
  },
  {
    role: "EXAMINER",
    label: "Examiner studio",
    screens: [
      { path: "/studio", title: "Studio overview", nav: true },
      { path: "/studio/exams", title: "Exams", nav: true },
      { path: "/studio/exams/new", title: "Create an exam" },
      { path: "/studio/exams/:id", title: "Exam overview" },
      ...examTabs.map(([tab, title]) => ({ path: "/studio/exams/:id/" + tab, title })),
      { path: "/studio/exams/:id/sandbox", title: "Candidate preview", exam: true },
      { path: "/studio/questions", title: "Question bank", nav: true },
      { path: "/studio/imports", title: "Import center", nav: true },
      { path: "/studio/disputes", title: "Dispute inbox", nav: true },
    ],
  },
  {
    role: "ADMIN",
    label: "Administration",
    screens: [
      { path: "/admin", title: "Platform overview", nav: true },
      { path: "/admin/users", title: "User directory", nav: true },
      { path: "/admin/users/:id", title: "User details" },
      { path: "/admin/imports", title: "Candidate imports", nav: true },
      { path: "/admin/audit", title: "Audit log", nav: true },
      { path: "/admin/disputes", title: "Escalated disputes", nav: true },
      { path: "/admin/system", title: "System", nav: true },
    ],
  },
];

export function roleHome(role: Role | undefined) {
  return workspaces.find((workspace) => workspace.role === role)?.screens[0]?.path ?? "/dashboard";
}


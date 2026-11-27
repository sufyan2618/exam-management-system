import { useParams, useSearchParams } from "react-router-dom";
import { AttemptScreen } from "./AttemptScreens";
import { CandidateDashboard, CandidateDisputes, CandidateResults, ExamBriefing } from "./CandidateScreens";
import { AdminOverview, AdminSystem, AdminUsers, AuditLog, ImportCenter } from "./OperationsScreens";
import { DisputeInbox, ExamHub, ExamWizard, QuestionBank, Sandbox, StudioOverview } from "./StudioScreens";
import type { Screen } from "./workspace-routes";

export function WorkspaceScreen({ screen }: { screen: Screen }) {
  const { id, examId, attemptId } = useParams();
  const [params] = useSearchParams();
  switch (screen.path) {
    case "/app":
    case "/app/exams": return <CandidateDashboard />;
    case "/app/exams/:examId": return examId ? <ExamBriefing id={examId} /> : null;
    case "/app/attempt/:attemptId":
    case "/app/attempt/:attemptId/review": return attemptId ? <AttemptScreen id={attemptId} review={screen.path.endsWith("/review")} /> : null;
    case "/app/results":
    case "/app/results/:attemptId": return <CandidateResults id={attemptId} />;
    case "/app/disputes":
    case "/app/disputes/:id": return <CandidateDisputes id={id} attempt={params.get("attempt") ?? undefined} />;
    case "/studio": return <StudioOverview />;
    case "/studio/exams": return <StudioOverview list />;
    case "/studio/exams/new": return <ExamWizard />;
    case "/studio/exams/:id/sandbox": return id ? <Sandbox id={id} /> : null;
    case "/studio/questions": return <QuestionBank />;
    case "/admin/imports":
    case "/studio/imports": return <ImportCenter />;
    case "/studio/disputes": return <DisputeInbox path="/api/disputes" />;
    case "/admin": return <AdminOverview />;
    case "/admin/users":
    case "/admin/users/:id": return <AdminUsers id={id} />;
    case "/admin/audit": return <AuditLog />;
    case "/admin/disputes": return <DisputeInbox path="/api/disputes?status=ESCALATED" />;
    case "/admin/system": return <AdminSystem />;
    default: return id && screen.path.startsWith("/studio/exams/:id")
      ? <ExamHub id={id} tab={screen.path.split("/")[4] ?? "overview"} /> : null;
  }
}

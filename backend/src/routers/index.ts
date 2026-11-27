import { Router } from "express";
import analyticsRouter from "./analytics.router";
import attemptRouter from "./attempt.router";
import authRouter from "./auth.router";
import disputeRouter from "./dispute.router";
import examRouter from "./exam.router";
import gradingRouter from "./grading.router";
import healthRouter from "./health.router";
import monitoringRouter from "./monitoring.router";
import reportRouter from "./report.router";
import importRouter from "./import.router";
import questionRouter from "./question.router";
import usersRouter from "./users.router";

const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(authRouter);
apiRouter.use(usersRouter);
apiRouter.use(questionRouter);
apiRouter.use(examRouter);
apiRouter.use(attemptRouter);
apiRouter.use(monitoringRouter);
apiRouter.use(gradingRouter);
apiRouter.use(analyticsRouter);
apiRouter.use(reportRouter);
apiRouter.use(importRouter);
apiRouter.use(disputeRouter);

export default apiRouter;

import * as c from "../controllers/question.controller";
import { createRouter } from "../lib/router";
import { categoryBody, categoryPatchBody, createQuestionBody, listQuestionsQuery, updateQuestionBody } from "../schemas/question.schema";
import { idParams } from "../utils/validators";

const r = createRouter("Question bank");
const EA = ["EXAMINER" as const, "ADMIN" as const];

r.get("/categories", { summary: "Category tree (own, admin: all)", access: EA }, c.listCategories);
r.post("/categories", { summary: "Create category", access: EA, body: categoryBody }, c.createCategory);
r.patch("/categories/:id", { summary: "Rename or move category", access: EA, params: idParams, body: categoryPatchBody }, c.updateCategory);
r.delete("/categories/:id", { summary: "Delete empty category", access: EA, params: idParams }, c.deleteCategory);

r.get("/questions", { summary: "Search the question bank", access: EA, query: listQuestionsQuery }, c.list);
r.post("/questions", { summary: "Create a question with options", access: EA, body: createQuestionBody }, c.create);
r.get("/questions/:id", { summary: "Get a question (with answer key; owner only)", access: EA, params: idParams }, c.get);
r.patch("/questions/:id", { summary: "Edit (If-Match); used questions fork a new version", access: EA, params: idParams, body: updateQuestionBody }, c.update);
r.delete("/questions/:id", { summary: "Delete, or archive if used", access: EA, params: idParams }, c.remove);
r.post("/questions/:id/duplicate", { summary: "Clone a question", access: EA, params: idParams }, c.duplicate);

export default r.router;

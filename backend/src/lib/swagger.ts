import type { Express } from "express";
import swaggerUi from "swagger-ui-express";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import { routeRegistry } from "./router";

function toSchema(schema: ZodTypeAny) {
  const json = zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "none" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const { method, path, tag, spec } of routeRegistry) {
    const oaPath = "/api/v1" + path.replace(/\\:/g, ":").replace(/:([A-Za-z]+)(?=\/|$)/g, "{$1}");
    const params = [...path.matchAll(/\/:([A-Za-z]+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    if (spec.query) {
      const q = toSchema(spec.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(q.properties ?? {})) {
        params.push({ name, in: "query", required: q.required?.includes(name) ?? false, schema } as never);
      }
    }
    const op: Record<string, unknown> = {
      tags: [tag],
      summary: spec.summary,
      description: spec.access === "public" ? "Public" : spec.access === "any" ? "Any authenticated role" : `Roles: ${spec.access.join(", ")}`,
      parameters: params,
      responses: {
        "200": { description: "Success: `{ data, meta? }`" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden" },
        "404": { description: "Not found" },
        "422": { description: "Validation failed" },
        "429": { description: "Rate limited" },
      },
    };
    if (spec.access !== "public") op.security = [{ bearerAuth: [] }];
    if (spec.body) op.requestBody = { required: true, content: { "application/json": { schema: toSchema(spec.body) } } };
    if (spec.idempotent) (op.parameters as unknown[]).push({ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", format: "uuid" } });
    (paths[oaPath] ??= {})[method] = op;
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "Secure Examination Management System API",
      version: "1.0.0",
      description:
        "Success envelope `{data, meta?}`; errors `{error:{code,message,details,requestId,retryable}}`. Server time is authoritative for every timed endpoint.",
    },
    servers: [{ url: "/" }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
    paths,
  };
}

export function setupSwagger(app: Express) {
  let doc: ReturnType<typeof buildOpenApiDocument> | undefined;
  const getDoc = () => (doc ??= buildOpenApiDocument());
  app.get("/api/docs.json", (_req, res) => {
    res.json(getDoc());
  });
  app.use("/api/docs", swaggerUi.serve, (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => swaggerUi.setup(getDoc())(req, res, next));
}

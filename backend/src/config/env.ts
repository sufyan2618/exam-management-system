import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

/** Docker Compose often injects `VAR=` as "" for unset optionals — treat blanks as missing. */
const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const bool = (def: boolean) =>
  z.preprocess(
    blankToUndef,
    z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? def : v === "true")),
  );

const optionalString = z.preprocess(blankToUndef, z.string().optional());
const optionalEmail = z.preprocess(blankToUndef, z.string().email().optional());
const optionalUrl = z.preprocess(blankToUndef, z.string().url().optional());
const optionalSecret = z.preprocess(blankToUndef, z.string().min(16).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(5000),
  MONGO_URI: z.string().min(1, "MONGO_URI is required"),
  REDIS_URL: z.string().url("REDIS_URL must be a valid URL"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  COOKIE_DOMAIN: optionalString,
  COOKIE_SECURE: bool(false),
  CLIENT_URL: z.string().url("CLIENT_URL must be a valid URL"),
  CORS_ORIGINS: optionalString,
  EMAIL_FROM: optionalEmail,
  BREVO_API_KEY: optionalString,
  REPORT_HMAC_SECRET: optionalSecret,
  PUBLIC_VERIFY_BASE_URL: optionalUrl,
  INSTITUTION_NAME: z.string().default("Secure Exam Platform"),
  GRACE_SECONDS: z.coerce.number().int().min(0).max(60).default(5),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(50).default(5),
  UPLOAD_DIR: z.string().default("./data/uploads"),
  LOG_LEVEL: z.string().default("info"),
  RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().default(3000),
  RATE_LIMIT_USER_PER_MIN: z.coerce.number().int().default(300),
  RATE_LIMIT_AUTOSAVE_PER_MIN: z.coerce.number().int().default(120),
  METRICS_TOKEN: optionalString,
  ALLOW_DEMO_SEED: bool(false),
  DISPUTE_SLA_HOURS: z.coerce.number().int().default(72),
  DISPUTE_COUNTERSIGN_MARKS: z.coerce.number().default(2),
  SCRATCHPAD_RETENTION_DAYS: z.coerce.number().int().default(30),
  INTEGRITY_RETENTION_DAYS: z.coerce.number().int().default(90),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
  throw new Error(`Invalid environment variables: ${issues}`);
}

const value = parsedEnv.data;

if (value.NODE_ENV === "production" && !value.REPORT_HMAC_SECRET) {
  throw new Error("Invalid environment variables: REPORT_HMAC_SECRET is required in production");
}

export const env = {
  ...value,
  REPORT_HMAC_SECRET: value.REPORT_HMAC_SECRET ?? `${value.JWT_SECRET}:report`,
  PUBLIC_VERIFY_BASE_URL: value.PUBLIC_VERIFY_BASE_URL ?? `${value.CLIENT_URL.replace(/\/$/, "")}/verify`,
  COOKIE_SECURE: value.NODE_ENV === "production" ? true : value.COOKIE_SECURE,
  CORS_ORIGINS: (value.CORS_ORIGINS ? value.CORS_ORIGINS.split(",").map((s) => s.trim()) : [value.CLIENT_URL]).filter(Boolean),
  IS_PROD: value.NODE_ENV === "production",
  IS_TEST: value.NODE_ENV === "test",
};

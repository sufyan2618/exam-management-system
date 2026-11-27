import { z } from "zod";

const ARGON = { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 } as const;

export const hashPassword = (password: string) => Bun.password.hash(password, ARGON);

export const verifyPasswordHash = (password: string, hash: string) => Bun.password.verify(password, hash);

let dummyHash: Promise<string> | undefined;
/** Verifies against a dummy hash so unknown-user logins take the same time as real ones. */
export async function dummyVerify(password: string) {
  dummyHash ??= hashPassword("dummy-password-for-timing-equalisation");
  await verifyPasswordHash(password, await dummyHash);
}

const COMMON = new Set(
  [
    "password", "password1", "password123", "passw0rd", "qwerty", "qwertyuiop", "qwerty123", "letmein", "welcome",
    "welcome1", "admin", "administrator", "iloveyou", "monkey", "dragon", "football", "baseball", "abc123",
    "123456", "1234567", "12345678", "123456789", "1234567890", "111111", "000000", "changeme", "p@ssw0rd",
    "admin123", "student", "teacher", "examiner", "candidate", "comsats", "lahore123", "pakistan",
  ].map((s) => s.toLowerCase()),
);

export function isWeakPassword(password: string) {
  const p = password.toLowerCase();
  if (COMMON.has(p)) return true;
  if (/^(.)\1+$/.test(p)) return true;
  return [...COMMON].some((c) => c.length >= 6 && p.replace(/[^a-z0-9]/g, "").startsWith(c) && p.length <= c.length + 3);
}

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128, "Password must be at most 128 characters")
  .refine((p) => !isWeakPassword(p), "Password is too common or easy to guess");

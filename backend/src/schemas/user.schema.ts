import { z } from "zod";
import { ROLES } from "../config/constants";
import { paginationQuery } from "../lib/pagination";
import { boolQuery, email, text } from "../utils/validators";

export const createUserBody = z
  .object({
    email,
    fullName: text(2, 120),
    role: z.enum(ROLES),
    registrationNo: text(1, 60).optional(),
    sendEmail: z.boolean().default(false),
  })
  .strict();

export const updateUserBody = z
  .object({
    fullName: text(2, 120).optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
    registrationNo: text(1, 60).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const listUsersQuery = z
  .object({ ...paginationQuery, role: z.enum(ROLES).optional(), isActive: boolQuery.optional() })
  .strict();

export type CreateUserInput = z.infer<typeof createUserBody>;
export type UpdateUserInput = z.infer<typeof updateUserBody>;
export type ListUsersQuery = z.infer<typeof listUsersQuery>;

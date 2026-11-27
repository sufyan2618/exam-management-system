import { z } from "zod";
import { passwordSchema } from "../utils/password";
import { email } from "../utils/validators";

export const loginBody = z.object({ email, password: z.string().min(1).max(128) }).strict();
export const changePasswordBody = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
  .strict()
  .refine((v) => v.currentPassword !== v.newPassword, { message: "New password must differ from the current password", path: ["newPassword"] });
export const forgotPasswordBody = z.object({ email }).strict();
export const resetPasswordBody = z.object({ token: z.string().min(20).max(200), newPassword: passwordSchema }).strict();

export type LoginInput = z.infer<typeof loginBody>;
export type ChangePasswordInput = z.infer<typeof changePasswordBody>;
export type ResetPasswordInput = z.infer<typeof resetPasswordBody>;

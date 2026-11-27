import type {
  LoginInput,
  LoginResponse,
  User,
  MessageResponse,
  ProfileResponse,
  RefreshResponse,
  UpdatePasswordInput,
} from "../types/auth";
import { apiRequest } from "./client";

export const authApi = {
  register(_input: unknown): Promise<ProfileResponse> { void _input; return Promise.reject(new Error("Accounts are created by an administrator.")); },
  verifyOtp(_input: unknown): Promise<MessageResponse> { void _input; return Promise.reject(new Error("Use the password reset link from your email.")); },
  resendOtp(_input: unknown): Promise<MessageResponse> { void _input; return Promise.reject(new Error("Request a password reset link.")); },
  login(input: LoginInput) {
    return apiRequest<{ data: { accessToken: string; user: { id: string } } }>("/api/auth/login", {
      method: "POST", body: input, auth: false,
    }).then(async ({ data }) => {
      const { useAuthStore } = await import("../store/auth.store");
      useAuthStore.getState().setAccessToken(data.accessToken);
      const profile = await authApi.profile();
      return { ...profile, accessToken: data.accessToken } as LoginResponse;
    });
  },

  refresh() {
    return apiRequest<RefreshResponse>("/api/auth/refresh", {
      method: "POST",
      body: {},
      auth: false,
    });
  },

  logout() {
    return apiRequest<MessageResponse>("/api/auth/logout", {
      method: "POST",
      auth: false,
    });
  },

  profile(signal?: AbortSignal) {
    return apiRequest<{data: {id: string; fullName: string; email: string; role: User["role"]; isActive: boolean; mustChangePassword: boolean; createdAt: string}}>("/api/auth/me", { signal }).then(({data}) => ({success: true, message: "", data: {...data, firstName: data.fullName, lastName: "", isVerified: true, isBlocked: !data.isActive, updatedAt: data.createdAt}}));
  },

  resetPassword(email: string) {
    return apiRequest<MessageResponse>("/api/auth/forgot-password", {
      method: "POST",
      body: { email },
      auth: false,
    });
  },

  updatePassword(input: UpdatePasswordInput) {
    return apiRequest<MessageResponse>("/api/auth/reset-password", {
      method: "POST",
      body: input,
      auth: false,
    });
  },
};

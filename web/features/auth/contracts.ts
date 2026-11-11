import type { AuthUser } from "@/shared/lib/auth";
export type LoginRequest = { username?: string; password?: string };
export type LoginSession = { token: string; user: AuthUser };
export type SmsLoginRequest = { mobile: string; code: string };
export type SmsCodeRequest = { mobile: string };

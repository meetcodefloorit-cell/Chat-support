import { TokenResponse, User, UserRole } from "@/lib/types";

const TOKEN_KEY = "chat_support_token";
const USER_KEY = "chat_support_user";

export function saveSession(payload: TokenResponse) {
  localStorage.setItem(TOKEN_KEY, payload.access_token);
  localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function getLoginPath(role?: UserRole): string {
  switch (role) {
    case "ADMIN":
      return "/admin/login";
    case "OPERATOR":
      return "/operator/login";
    case "MEMBER":
      return "/member/login";
    default:
      return "/";
  }
}

export function getDashboardPath(user: User): string {
  switch (user.role) {
    case "ADMIN":
      return "/admin/dashboard";
    case "OPERATOR":
      return `/operator/${user.uid}`;
    case "MEMBER":
      return `/member/${user.uid}`;
    default:
      return "/";
  }
}

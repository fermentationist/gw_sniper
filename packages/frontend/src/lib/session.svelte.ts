import { api, ApiError } from "./api.js";

export const session = $state({
  authenticated: false as boolean,
  loading: true as boolean,
});

export async function checkSession(): Promise<void> {
  session.loading = true;
  try {
    const res = await api.get<{ authenticated: boolean }>("/api/auth/session");
    session.authenticated = res.authenticated;
  } catch {
    session.authenticated = false;
  } finally {
    session.loading = false;
  }
}

export async function login(password: string): Promise<void> {
  await api.post("/api/auth/login", { password });
  session.authenticated = true;
}

export async function logout(): Promise<void> {
  try {
    await api.post("/api/auth/logout");
  } finally {
    session.authenticated = false;
  }
}

export function handleUnauthorized(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 401) {
    session.authenticated = false;
    return true;
  }
  return false;
}

import { randomBytes } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { isProd } from "../env.js";
import { signSessionToken, verifySessionToken } from "./crypto.js";

const COOKIE_NAME = "gw_sid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function issueSession(c: Context): void {
  const payload = `${Date.now()}:${randomBytes(16).toString("base64url")}`;
  const token = signSessionToken(payload);
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isProd,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

export function readSession(c: Context): string | null {
  const raw = getCookie(c, COOKIE_NAME);
  if (!raw) return null;
  return verifySessionToken(raw);
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const session = readSession(c);
  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("session", session);
  await next();
};

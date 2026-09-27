import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { clearSession, issueSession, readSession } from "../lib/auth.js";
import { verifyAppPassword } from "../lib/crypto.js";

const loginSchema = z.object({ password: z.string().min(1) });

export const authRoutes = new Hono();

authRoutes.post("/login", zValidator("json", loginSchema), (c) => {
  const { password } = c.req.valid("json");
  if (!verifyAppPassword(password)) {
    return c.json({ error: "invalid_password" }, 401);
  }
  issueSession(c);
  return c.json({ ok: true });
});

authRoutes.post("/logout", (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

authRoutes.get("/session", (c) => {
  const session = readSession(c);
  return c.json({ authenticated: session !== null });
});

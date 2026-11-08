import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";

const scrypt = promisify(scryptCallback);
export const SESSION_TTL_MS = 15 * 60 * 1000;
const COOKIE_NAME = "stanlab_session";
type Session = { createdAt: number; expiresAt: number };
const sessions = new Map<string, Session>();

const dataDirectory =
  process.env.STANLAB_DATA_DIR ??
  path.resolve(
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    "stanlab-dash",
  );
const credentialsPath = path.join(dataDirectory, "credentials.json");

export async function loadCredentials(): Promise<{
  username: string;
  passwordHash: string;
}> {
  if (process.env.DASH_USERNAME && process.env.DASH_PASSWORD_HASH) {
    return {
      username: process.env.DASH_USERNAME,
      passwordHash: process.env.DASH_PASSWORD_HASH,
    };
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(credentialsPath, "utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      "username" in parsed &&
      "passwordHash" in parsed &&
      typeof parsed.username === "string" &&
      typeof parsed.passwordHash === "string" &&
      /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(parsed.passwordHash)
    ) {
      return { username: parsed.username, passwordHash: parsed.passwordHash };
    }
  } catch {
    /* Credentials are created by the `setup` command on first run. */
  }
  return { username: "", passwordHash: "" };
}

export async function getSessionRemainingMs(
  id: string | undefined,
): Promise<number> {
  if (!id) return 0;
  const session = await readSession(id);
  return Math.max(0, (session?.expiresAt ?? 0) - Date.now());
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, salt, digest] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !digest || digest.length !== 128)
    return false;
  try {
    const expected = Buffer.from(digest, "hex");
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

export async function createSession(res: Response): Promise<void> {
  const now = Date.now();
  const id = randomBytes(32).toString("hex");
  const session = { createdAt: now, expiresAt: now + SESSION_TTL_MS };
  sessions.set(id, session);
  res.cookie(COOKIE_NAME, id, {
    httpOnly: true,
    secure: process.env.DASH_COOKIE_SECURE === "true",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

export async function destroySession(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.cookies?.[COOKIE_NAME];
  try {
    if (typeof id === "string") {
      sessions.delete(id);
    }
  } finally {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.DASH_COOKIE_SECURE === "true",
      sameSite: "strict",
      path: "/",
    });
  }
}

export async function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = req.cookies?.[COOKIE_NAME];
  try {
    const session = typeof id === "string" ? await readSession(id) : undefined;
    if (!session || session.expiresAt <= Date.now()) {
      if (typeof id === "string") {
        sessions.delete(id);
      }
      res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.DASH_COOKIE_SECURE === "true",
        sameSite: "strict",
        path: "/",
      });
      res.status(401).json({ error: "Your session expired. Sign in again." });
      return;
    }
    next();
  } catch {
    res
      .status(503)
      .json({ error: "The session service is temporarily unavailable." });
  }
}

async function readSession(id: string): Promise<Session | undefined> {
  return sessions.get(id);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions)
    if (session.expiresAt <= now) sessions.delete(id);
}, 60_000).unref();

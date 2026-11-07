import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';

const scrypt = promisify(scryptCallback);
export const SESSION_TTL_MS = 15 * 60 * 1000;
const COOKIE_NAME = 'stanlab_session';
type Session = { createdAt: number; expiresAt: number };
const sessions = new Map<string, Session>();
export function getSessionRemainingMs(id: string | undefined): number {
  return id ? Math.max(0, (sessions.get(id)?.expiresAt ?? 0) - Date.now()) : 0;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, digest] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !digest || digest.length !== 128) return false;
  try {
    const expected = Buffer.from(digest, 'hex');
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createSession(res: Response): void {
  const now = Date.now();
  const id = randomBytes(32).toString('hex');
  sessions.set(id, { createdAt: now, expiresAt: now + SESSION_TTL_MS });
  res.cookie(COOKIE_NAME, id, { httpOnly: true, secure: process.env.DASH_COOKIE_SECURE === 'true', sameSite: 'strict', path: '/', maxAge: SESSION_TTL_MS });
}

export function destroySession(req: Request, res: Response): void {
  const id = req.cookies?.[COOKIE_NAME];
  if (typeof id === 'string') sessions.delete(id);
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: process.env.DASH_COOKIE_SECURE === 'true', sameSite: 'strict', path: '/' });
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const id = req.cookies?.[COOKIE_NAME];
  const session = typeof id === 'string' ? sessions.get(id) : undefined;
  if (!session || session.expiresAt <= Date.now()) {
    if (typeof id === 'string') sessions.delete(id);
    res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: process.env.DASH_COOKIE_SECURE === 'true', sameSite: 'strict', path: '/' });
    res.status(401).json({ error: 'Your session expired. Sign in again.' });
    return;
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
}, 60_000).unref();

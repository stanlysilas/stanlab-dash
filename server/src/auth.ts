import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { createClient } from 'redis';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';

const scrypt = promisify(scryptCallback);
export const SESSION_TTL_MS = 15 * 60 * 1000;
const COOKIE_NAME = 'stanlab_session';
const SESSION_PREFIX = 'stanlab:session:';
type Session = { createdAt: number; expiresAt: number };
const sessions = new Map<string, Session>();
const redisUrl = process.env.REDIS_URL;
const useRedis = process.env.SESSION_STORE === 'redis';
const redis = useRedis && redisUrl ? createClient({
  url: redisUrl,
  socket: {
    connectTimeout: 5_000,
    reconnectStrategy: (retries) => retries < 5 ? Math.min(250 * (retries + 1), 2_000) : false,
  },
}) : null;
redis?.on('error', () => console.error('Stanlab Redis session store connection error.'));

export async function initializeSessionStore() {
  if (useRedis && !redisUrl) throw new Error('SESSION_STORE=redis requires REDIS_URL.');
  if (redis && !redis.isOpen) await redis.connect();
}

export async function getSessionRemainingMs(id: string | undefined): Promise<number> {
  if (!id) return 0;
  const session = await readSession(id);
  return Math.max(0, (session?.expiresAt ?? 0) - Date.now());
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

export async function createSession(res: Response): Promise<void> {
  const now = Date.now();
  const id = randomBytes(32).toString('hex');
  const session = { createdAt: now, expiresAt: now + SESSION_TTL_MS };
  if (redis) await redis.set(`${SESSION_PREFIX}${id}`, JSON.stringify(session), { PX: SESSION_TTL_MS });
  else sessions.set(id, session);
  res.cookie(COOKIE_NAME, id, { httpOnly: true, secure: process.env.DASH_COOKIE_SECURE === 'true', sameSite: 'strict', path: '/', maxAge: SESSION_TTL_MS });
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  const id = req.cookies?.[COOKIE_NAME];
  try {
    if (typeof id === 'string') {
      if (redis) await redis.del(`${SESSION_PREFIX}${id}`);
      else sessions.delete(id);
    }
  } finally {
    res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: process.env.DASH_COOKIE_SECURE === 'true', sameSite: 'strict', path: '/' });
  }
}

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = req.cookies?.[COOKIE_NAME];
  try {
    const session = typeof id === 'string' ? await readSession(id) : undefined;
    if (!session || session.expiresAt <= Date.now()) {
      if (typeof id === 'string') {
        if (redis) await redis.del(`${SESSION_PREFIX}${id}`);
        else sessions.delete(id);
      }
      res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: process.env.DASH_COOKIE_SECURE === 'true', sameSite: 'strict', path: '/' });
      res.status(401).json({ error: 'Your session expired. Sign in again.' });
      return;
    }
    next();
  } catch {
    res.status(503).json({ error: 'The session service is temporarily unavailable.' });
  }
}

async function readSession(id: string): Promise<Session | undefined> {
  if (!redis) return sessions.get(id);
  const value = await redis.get(`${SESSION_PREFIX}${id}`);
  if (!value) return undefined;
  try {
    const session: unknown = JSON.parse(value);
    if (session && typeof session === 'object' && 'createdAt' in session && 'expiresAt' in session && typeof session.createdAt === 'number' && typeof session.expiresAt === 'number') {
      return { createdAt: session.createdAt, expiresAt: session.expiresAt };
    }
  } catch { /* Treat malformed session data as expired. */ }
  await redis.del(`${SESSION_PREFIX}${id}`);
  return undefined;
}

if (!useRedis) setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
}, 60_000).unref();

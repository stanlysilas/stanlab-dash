import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { createSession, destroySession, getSessionRemainingMs, requireSession, SESSION_TTL_MS, verifyPassword } from './auth.js';
import { getMetrics } from './metrics.js';
import { listScripts, runScript, setDisplayManager } from './actions.js';
import { actOnStoreApp, getSavedLaunchers, installStoreApp, listStoreApps, saveLaunchers } from './store.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.DASH_BIND_ADDRESS ?? (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');
const username = process.env.DASH_USERNAME ?? '';
const passwordHash = process.env.DASH_PASSWORD_HASH ?? '';
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const configuredOrigin = process.env.DASH_ORIGIN ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
  if (!origin || origin !== configuredOrigin) {
    res.status(403).json({ error: 'This request did not come from the configured dashboard origin.' });
    return;
  }
  next();
});

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const loginSchema = z.object({ username: z.string().min(1).max(128), password: z.string().min(1).max(1024) }).strict();
const scriptSchema = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/) }).strict();
const storeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const launchersSchema = z.array(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(48), url: z.string().trim().min(1).max(2048) }).strict()).max(80);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/auth/session', requireSession, (req, res) => res.json({ authenticated: true, username, hostname: os.hostname(), expiresInMs: getSessionRemainingMs(req.cookies?.stanlab_session) }));

app.post('/api/auth/login', async (req, res) => {
  const address = req.ip ?? 'unknown';
  const now = Date.now();
  const attempts = loginAttempts.get(address);
  if (attempts && attempts.resetAt > now && attempts.count >= 8) {
    res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.' });
    return;
  }
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success || !username || !passwordHash || parsed.data.username !== username || !(await verifyPassword(parsed.data.password, passwordHash))) {
    const current = attempts && attempts.resetAt > now ? attempts : { count: 0, resetAt: now + 10 * 60 * 1000 };
    loginAttempts.set(address, { ...current, count: current.count + 1 });
    res.status(!username || !passwordHash ? 503 : 401).json({ error: !username || !passwordHash ? 'Authentication is not configured. Set DASH_USERNAME and DASH_PASSWORD_HASH.' : 'Username or password is incorrect.' });
    return;
  }
  loginAttempts.delete(address);
  createSession(res);
  res.json({ authenticated: true, username, hostname: os.hostname(), expiresInMs: SESSION_TTL_MS });
});

app.post('/api/auth/logout', requireSession, (req, res) => {
  destroySession(req, res);
  res.status(204).end();
});

app.use('/api', requireSession);
app.get('/api/metrics', async (_req, res) => res.json(await getMetrics()));
app.get('/api/scripts', async (_req, res) => res.json({ scripts: await listScripts() }));
app.get('/api/capabilities', async (_req, res) => res.json({ displayManagerEnabled: process.env.DASH_GDM_ENABLED === 'true', scripts: await listScripts() }));
app.get('/api/launchers', async (_req, res) => res.json({ launchers: await getSavedLaunchers() }));
app.put('/api/launchers', async (req, res) => {
  const parsed = launchersSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Launcher data is invalid.' }); return; }
  try {
    const launchers = await saveLaunchers(parsed.data);
    res.json({ launchers });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Launchers could not be saved.' }); }
});
app.get('/api/store', async (_req, res) => {
  try { res.json(await listStoreApps()); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'The app store could not be read.' }); }
});
app.post('/api/store/apps/:id/install', async (req, res) => {
  const parsed = storeIdSchema.safeParse(req.params.id);
  if (!parsed.success) { res.status(400).json({ error: 'Choose an app from the built-in store.' }); return; }
  try { res.json(await installStoreApp(parsed.data)); }
  catch (error) { const message = error instanceof Error ? error.message : 'The app could not be installed.'; res.status(message.includes('Compose runtime') ? 503 : 400).json({ error: message }); }
});
app.post('/api/store/apps/:id/:action', async (req, res) => {
  const id = storeIdSchema.safeParse(req.params.id);
  const action = z.enum(['start', 'stop', 'restart', 'update', 'uninstall']).safeParse(req.params.action);
  if (!id.success || !action.success) { res.status(400).json({ error: 'Choose a valid app action.' }); return; }
  try { res.json(await actOnStoreApp(id.data, action.data)); }
  catch (error) { const message = error instanceof Error ? error.message : 'The app action failed.'; res.status(message.includes('Compose runtime') ? 503 : 400).json({ error: message }); }
});
app.post('/api/scripts/run', async (req, res) => {
  const parsed = scriptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose a configured script.' });
    return;
  }
  try {
    res.json(await runScript(parsed.data.id));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Script could not be run.' });
  }
});
app.post('/api/display-manager/:action', async (req, res) => {
  if (req.params.action !== 'start' && req.params.action !== 'stop') {
    res.status(404).json({ error: 'Unknown display manager action.' });
    return;
  }
  try {
    await setDisplayManager(req.params.action === 'start');
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'Display manager action failed.' });
  }
});

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(process.cwd(), 'dist/client');
  app.use(express.static(clientDist));
  app.get('*path', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.listen(port, host, () => {
  console.log(`Stanlab Dash listening on http://${host}:${port}`);
  if (!username || !passwordHash) console.warn('Authentication is not configured. Set DASH_USERNAME and DASH_PASSWORD_HASH before use.');
});

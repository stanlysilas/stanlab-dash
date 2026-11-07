import 'dotenv/config';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { chmod, lstat, mkdir, rm } from 'node:fs/promises';
import { z } from 'zod';
import { getMetrics } from './metrics.js';
import { listScripts, runScript, setDisplayManager } from './actions.js';
import { actOnStoreApp, getSavedLaunchers, installStoreApp, listStoreApps, saveLaunchers } from './store.js';

const socketPath = process.env.DASH_HOST_AGENT_SOCKET;
if (!socketPath) throw new Error('DASH_HOST_AGENT_SOCKET must point to the private host-agent socket.');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
const scriptSchema = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/) }).strict();
const storeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const launchersSchema = z.array(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(48), url: z.string().trim().min(1).max(2048) }).strict()).max(80);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/hostname', (_req, res) => res.json({ hostname: os.hostname() }));
app.get('/api/metrics', async (_req, res) => res.json(await getMetrics()));
app.get('/api/scripts', async (_req, res) => res.json({ scripts: await listScripts() }));
app.get('/api/capabilities', async (_req, res) => res.json({ displayManagerEnabled: process.env.DASH_GDM_ENABLED === 'true', scripts: await listScripts() }));
app.post('/api/scripts/run', async (req, res) => {
  const parsed = scriptSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Choose a configured script.' }); return; }
  try { res.json(await runScript(parsed.data.id)); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Script could not be run.' }); }
});
app.post('/api/display-manager/:action', async (req, res) => {
  if (req.params.action !== 'start' && req.params.action !== 'stop') { res.status(404).json({ error: 'Unknown display manager action.' }); return; }
  try { await setDisplayManager(req.params.action === 'start'); res.json({ ok: true }); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'Display manager action failed.' }); }
});
app.get('/api/launchers', async (_req, res) => res.json({ launchers: await getSavedLaunchers() }));
app.put('/api/launchers', async (req, res) => {
  const parsed = launchersSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Launcher data is invalid.' }); return; }
  try { res.json({ launchers: await saveLaunchers(parsed.data) }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Launchers could not be saved.' }); }
});
app.get('/api/store', async (_req, res) => {
  try { res.json(await listStoreApps()); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'The app store could not be read.' }); }
});
app.post('/api/store/apps/:id/install', async (req, res) => {
  const id = storeIdSchema.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: 'Choose an app from the built-in store.' }); return; }
  try { res.json(await installStoreApp(id.data)); }
  catch (error) { const message = error instanceof Error ? error.message : 'The app could not be installed.'; res.status(message.includes('Compose runtime') ? 503 : 400).json({ error: message }); }
});
app.post('/api/store/apps/:id/:action', async (req, res) => {
  const id = storeIdSchema.safeParse(req.params.id);
  const action = z.enum(['start', 'stop', 'restart', 'update', 'uninstall']).safeParse(req.params.action);
  if (!id.success || !action.success) { res.status(400).json({ error: 'Choose a valid app action.' }); return; }
  try { res.json(await actOnStoreApp(id.data, action.data)); }
  catch (error) { const message = error instanceof Error ? error.message : 'The app action failed.'; res.status(message.includes('Compose runtime') ? 503 : 400).json({ error: message }); }
});
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Stanlab host helper request failed:', error instanceof Error ? error.message : 'Unknown error');
  res.status(500).json({ error: 'The host operation could not be completed.' });
});

await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
await chmod(path.dirname(socketPath), 0o700);
try {
  const existing = await lstat(socketPath);
  if (!existing.isSocket()) throw new Error(`Refusing to replace a non-socket at ${socketPath}.`);
  await rm(socketPath);
} catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
}
const server = app.listen(socketPath, async () => {
  await chmod(socketPath, 0o600);
  console.log('Stanlab host helper is listening on its private user socket.');
});
server.on('error', (error) => { console.error('Stanlab host helper could not listen:', error.message); process.exitCode = 1; });

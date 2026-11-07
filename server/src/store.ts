import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

type StoreDefinition = {
  id: string;
  name: string;
  category: string;
  description: string;
  image: string;
  containerPort: number;
  volumes: Array<{ name: string; target: string }>;
  notes: string[];
};
type InstalledRecord = { id: string; port: number; installedAt: string };
type StoreState = { apps: InstalledRecord[] };
type Engine = { name: 'Docker Compose' | 'Podman Compose'; command: string; prefix: string[] };

const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
const storeRoot = path.resolve(dataHome, 'stanlab-dash', 'store');
const statePath = path.join(storeRoot, 'installed.json');
const definitions: StoreDefinition[] = [
  { id: 'jellyfin', name: 'Jellyfin', category: 'Media', description: 'A media system for organizing and streaming your personal library.', image: 'jellyfin/jellyfin:latest', containerPort: 8096, volumes: [{ name: 'config', target: '/config' }, { name: 'cache', target: '/cache' }], notes: ['This installs the server and its settings. Add media folders in Jellyfin after installation.', 'Hardware transcoding can be configured later for the production host.'] },
  { id: 'uptime-kuma', name: 'Uptime Kuma', category: 'Monitoring', description: 'A self-hosted status monitor for services and network endpoints.', image: 'louislam/uptime-kuma:2', containerPort: 3001, volumes: [{ name: 'data', target: '/app/data' }], notes: ['Persistent app data is stored in a managed container volume.'] },
  { id: 'home-assistant', name: 'Home Assistant', category: 'Home automation', description: 'Home automation with a local web interface and a large integration ecosystem.', image: 'ghcr.io/home-assistant/home-assistant:stable', containerPort: 8123, volumes: [{ name: 'config', target: '/config' }], notes: ['Uses an automatically assigned host port mapped to its web interface on 8123. Some local device discovery integrations may require additional network configuration.', 'The app and its integrations are configured in Home Assistant after installation.'] },
];

export async function listStoreApps() {
  const engine = await findEngine();
  const state = await readState();
  const apps = await Promise.all(definitions.map(async (definition) => {
    const installed = state.apps.find((record) => record.id === definition.id);
    let status: 'available' | 'running' | 'stopped' = 'available';
    if (installed) {
      status = 'stopped';
      if (engine) {
        try {
          const output = await compose(engine, definition.id, ['ps', '-q']);
          if (output.trim()) status = 'running';
        } catch { /* Engine errors are shown by the action endpoint; the app remains listed. */ }
      }
    }
    return { ...definition, installed: Boolean(installed), status, port: installed?.port ?? null, installedAt: installed?.installedAt ?? null };
  }));
  return { runtime: engine ? engine.name : null, runtimeAvailable: Boolean(engine), apps };
}

export async function installStoreApp(id: string) {
  const definition = getDefinition(id);
  const engine = await requireEngine();
  const state = await readState();
  const existing = state.apps.find((record) => record.id === id);
  if (existing) throw new Error(`${definition.name} is already installed.`);
  const appDir = path.join(storeRoot, id);
  await mkdir(storeRoot, { recursive: true, mode: 0o700 });
  await chmod(storeRoot, 0o700);
  await mkdir(appDir, { recursive: true, mode: 0o700 });
  await chmod(appDir, 0o700);
  try {
    await writeFile(path.join(appDir, 'compose.yaml'), composeManifest(definition), { mode: 0o600 });
    await compose(engine, id, ['up', '-d']);
    const port = await publishedPort(engine, id, definition.containerPort);
    const record: InstalledRecord = { id, port, installedAt: new Date().toISOString() };
    await saveState({ apps: [...state.apps, record] });
    return { ok: true, app: { ...definition, installed: true, status: 'running' as const, port, installedAt: record.installedAt } };
  } catch (error) {
    await compose(engine, id, ['down']).catch(() => undefined);
    await rm(appDir, { recursive: true, force: true });
    throw error;
  }
}

export async function actOnStoreApp(id: string, action: 'start' | 'stop' | 'restart' | 'update' | 'uninstall') {
  const definition = getDefinition(id);
  const engine = await requireEngine();
  const state = await readState();
  const installed = state.apps.find((record) => record.id === id);
  if (!installed) throw new Error(`${definition.name} is not installed.`);
  if (action === 'start') await compose(engine, id, ['up', '-d']);
  if (action === 'stop') await compose(engine, id, ['stop']);
  if (action === 'restart') await compose(engine, id, ['restart']);
  if (action === 'update') {
    await compose(engine, id, ['pull']);
    await compose(engine, id, ['up', '-d']);
  }
  if (action === 'uninstall') {
    await compose(engine, id, ['down']);
    await rm(path.join(storeRoot, id), { recursive: true, force: true });
    await saveState({ apps: state.apps.filter((record) => record.id !== id) });
    return { ok: true, message: `${definition.name} removed. Its persistent data volume was kept.` };
  }
  return { ok: true, message: `${definition.name} ${action} completed.` };
}

function getDefinition(id: string) {
  const definition = definitions.find((item) => item.id === id);
  if (!definition) throw new Error('Choose an app from the built-in store.');
  return definition;
}

async function findEngine(): Promise<Engine | null> {
  const candidates: Engine[] = [
    { name: 'Docker Compose', command: 'docker', prefix: ['compose'] },
    { name: 'Podman Compose', command: 'podman', prefix: ['compose'] },
  ];
  for (const candidate of candidates) {
    try {
      await run(candidate.command, [...candidate.prefix, 'version'], 8_000);
      const infoArgs = candidate.command === 'docker' ? ['info', '--format', '{{.ServerVersion}}'] : ['info', '--format', 'json'];
      await run(candidate.command, infoArgs, 8_000);
      return candidate;
    } catch { /* Try the next supported engine/provider. */ }
  }
  return null;
}

async function requireEngine() {
  const engine = await findEngine();
  if (!engine) throw new Error('Compose runtime unavailable: Stanlab cannot reach a Docker or Podman engine. Enable the optional App Store Compose overlay and verify Docker socket access.');
  return engine;
}

async function compose(engine: Engine, id: string, args: string[]) {
  const appDir = path.join(storeRoot, id);
  return run(engine.command, [...engine.prefix, '--project-name', `stanlab-${id}`, '--file', path.join(appDir, 'compose.yaml'), ...args], 10 * 60_000, appDir);
}

function run(command: string, args: string[], timeoutMs: number, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, HOME: os.homedir() }, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let output = '';
    const append = (chunk: string) => { output = `${output}${chunk}`.slice(-16_000); };
    child.stdout.setEncoding('utf8').on('data', append);
    child.stderr.setEncoding('utf8').on('data', append);
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${command} timed out. ${output.trim()}`)); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(new Error(`${command} could not run: ${error.message}`)); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(output.trim() || `${command} exited with status ${code ?? 'unknown'}.`));
    });
  });
}

function composeManifest(definition: StoreDefinition) {
  // Let the host Docker daemon allocate the published port; this process runs in a different network namespace.
  const ports = `    ports:\n      - "${definition.containerPort}"\n`;
  const volumes = definition.volumes.map(({ name, target }) => `      - ${name}:${target}`).join('\n');
  const declaredVolumes = definition.volumes.map(({ name }) => `  ${name}:`).join('\n');
  return `services:\n  app:\n    image: ${definition.image}\n    restart: unless-stopped\n${ports}    volumes:\n${volumes}\n    logging:\n      driver: json-file\n      options:\n        max-size: "10m"\n        max-file: "3"\n\nvolumes:\n${declaredVolumes}\n`;
}

async function readState(): Promise<StoreState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(statePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && 'apps' in parsed && Array.isArray(parsed.apps)) {
      return { apps: parsed.apps.filter((entry): entry is InstalledRecord => Boolean(entry && typeof entry.id === 'string' && definitions.some((definition) => definition.id === entry.id) && Number.isInteger(entry.port) && typeof entry.installedAt === 'string')) };
    }
  } catch { /* First run or invalid state starts with an empty managed list. */ }
  return { apps: [] };
}

async function saveState(state: StoreState) {
  await mkdir(storeRoot, { recursive: true, mode: 0o700 });
  await chmod(storeRoot, 0o700);
  const temporary = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await chmod(temporary, 0o600);
  await rename(temporary, statePath);
}

async function publishedPort(engine: Engine, id: string, containerPort: number) {
  const output = await compose(engine, id, ['port', 'app', String(containerPort)]);
  const match = output.trim().match(/:(\d+)\s*$/);
  if (!match) throw new Error('Compose started the app but did not report its published host port.');
  return Number(match[1]);
}

type SavedLauncher = { id: string; name: string; url: string };

export async function getSavedLaunchers(): Promise<SavedLauncher[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(storeRoot, 'launchers.json'), 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedLauncher => Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.url === 'string' && safeHttpUrl(item.url)));
  } catch { return []; }
}

export async function saveLaunchers(launchers: SavedLauncher[]) {
  const seen = new Set<string>();
  for (const launcher of launchers) {
    if (seen.has(launcher.id)) throw new Error('Launcher IDs must be unique.');
    if (!safeHttpUrl(launcher.url)) throw new Error('Launcher URLs must use http:// or https:// and cannot include credentials.');
    seen.add(launcher.id);
  }
  await mkdir(storeRoot, { recursive: true, mode: 0o700 });
  await chmod(storeRoot, 0o700);
  const launchersPath = path.join(storeRoot, 'launchers.json');
  const temporary = `${launchersPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(launchers, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, launchersPath);
  return launchers;
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

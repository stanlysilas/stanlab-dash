import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(process.cwd());
const scriptRoot = path.join(projectRoot, 'scripts');
const manifestPath = path.join(projectRoot, 'config', 'scripts.json');
const manifestSchema = z.object({ scripts: z.array(z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/), label: z.string().min(1).max(64), file: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.sh$/) })).max(30) }).strict();

export async function listScripts() {
  try {
    const parsed = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
    return await Promise.all(parsed.scripts.map(async (script) => {
      try {
        const actual = await realpath(path.join(scriptRoot, script.file));
        const root = await realpath(scriptRoot);
        return { ...script, available: actual.startsWith(`${root}${path.sep}`) };
      } catch {
        return { ...script, available: false };
      }
    }));
  } catch {
    return [];
  }
}

export async function runScript(id: string) {
  const scripts = await listScripts();
  const script = scripts.find((item) => item.id === id && item.available);
  if (!script) throw new Error('That script is not configured or its file is missing.');
  const root = await realpath(scriptRoot);
  const file = await realpath(path.join(root, script.file));
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Script path is outside the configured folder.');
  const { stdout, stderr } = await execFileAsync('/bin/bash', [file], { cwd: root, timeout: 30_000, maxBuffer: 64_000, windowsHide: true });
  return { output: [stdout, stderr].filter(Boolean).join('\n').slice(0, 12_000) };
}

export async function setDisplayManager(running: boolean) {
  if (process.env.DASH_GDM_ENABLED !== 'true') throw new Error('Display manager controls are disabled. Configure and enable them on the host first.');
  const action = running ? 'start' : 'stop';
  await execFileAsync('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', action, 'gdm.service'], { timeout: 10_000, maxBuffer: 16_000, windowsHide: true });
}

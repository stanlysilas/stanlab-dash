import { execFile } from 'node:child_process';
import { readdir, readFile, readlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
type ProcessStat = {
  name: string;
  state: string;
  parentPid: number;
  startToken: string;
  cpuTicks: bigint;
};
type IoSample = { readBytes: number | null; writeBytes: number | null };
type PreviousSample = {
  cpuTicks: bigint;
  readBytes: number | null;
  writeBytes: number | null;
  sampledAt: number;
};
export type ProcessAction = 'suspend' | 'resume' | 'terminate' | 'kill';
export type ProcessRow = {
  pid: number;
  startToken: string;
  name: string;
  state: string;
  ownerUid: number;
  canControl: boolean;
  cpuPercent: number | null;
  gpuMemoryBytes: number | null;
  memoryBytes: number | null;
  diskReadBytesPerSecond: number | null;
  diskWriteBytesPerSecond: number | null;
};
export type ProcessList = {
  scope: 'host' | 'unavailable';
  capturedAt: string;
  processes: ProcessRow[];
};

const previousSamples = new Map<number, PreviousSample>();
const clockTicksPerSecond = loadClockTicks();

export async function listProcesses(): Promise<ProcessList> {
  if (!hostProcessViewEnabled()) {
    return { scope: 'unavailable', capturedAt: new Date().toISOString(), processes: [] };
  }

  const pidEntries = await readdir('/proc', { withFileTypes: true });
  const pids = pidEntries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));
  const [tickRate, gpuMemoryByPid, protectedPids] = await Promise.all([
    clockTicksPerSecond,
    readGpuMemoryByPid(),
    getProtectedPids(),
  ]);
  const now = Date.now();
  const rows: ProcessRow[] = [];
  const nextSamples = new Map<number, PreviousSample>();

  for (let offset = 0; offset < pids.length; offset += 32) {
    const batch = pids.slice(offset, offset + 32);
    const batchRows = await Promise.all(batch.map(async (pid) => {
      const current = await readProcess(pid);
      if (!current) return null;
      const prior = previousSamples.get(pid);
      const elapsedSeconds = prior ? Math.max(0.001, (now - prior.sampledAt) / 1000) : 0;
      const cpuDelta = prior ? current.stat.cpuTicks - prior.cpuTicks : -1n;
      const cpuPercent = prior && cpuDelta >= 0n
        ? Math.min(os.cpus().length * 100, Number(cpuDelta) / tickRate / elapsedSeconds * 100)
        : null;
      const canReadIo = current.io.readBytes !== null && current.io.writeBytes !== null;
      const diskReadBytesPerSecond = prior && canReadIo && prior.readBytes !== null
        ? Math.max(0, current.io.readBytes! - prior.readBytes) / elapsedSeconds
        : null;
      const diskWriteBytesPerSecond = prior && canReadIo && prior.writeBytes !== null
        ? Math.max(0, current.io.writeBytes! - prior.writeBytes) / elapsedSeconds
        : null;
      nextSamples.set(pid, {
        cpuTicks: current.stat.cpuTicks,
        readBytes: current.io.readBytes,
        writeBytes: current.io.writeBytes,
        sampledAt: now,
      });
      const uid = process.getuid?.();
      return {
        pid,
        startToken: current.stat.startToken,
        name: current.name,
        state: current.stat.state,
        ownerUid: current.ownerUid,
        canControl: pid > 1 && pid !== process.pid && uid !== undefined && current.ownerUid === uid && !protectedPids.has(pid),
        cpuPercent,
        gpuMemoryBytes: gpuMemoryByPid.get(pid) ?? null,
        memoryBytes: current.memoryBytes,
        diskReadBytesPerSecond,
        diskWriteBytesPerSecond,
      } satisfies ProcessRow;
    }));
    for (const row of batchRows) if (row) rows.push(row);
  }

  previousSamples.clear();
  for (const [pid, sample] of nextSamples) previousSamples.set(pid, sample);
  rows.sort((a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1) || a.name.localeCompare(b.name));
  return { scope: 'host', capturedAt: new Date(now).toISOString(), processes: rows };
}

export async function actOnProcess(pid: number, startToken: string, action: ProcessAction) {
  if (!hostProcessViewEnabled()) throw new Error('Host process access is not enabled for this deployment.');
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) throw new Error('That process cannot be controlled.');
  const current = await readProcess(pid);
  const uid = process.getuid?.();
  if (!current || current.stat.startToken !== startToken) throw new Error('That process has already exited or changed. Refresh the list.');
  if (uid === undefined || current.ownerUid !== uid) throw new Error('You can only control processes owned by the Stanlab Linux user.');
  const protectedPids = await getProtectedPids();
  if (protectedPids.has(pid)) throw new Error('Stanlab and its parent processes are protected.');
  const signal = {
    suspend: 'SIGSTOP',
    resume: 'SIGCONT',
    terminate: 'SIGTERM',
    kill: 'SIGKILL',
  }[action];
  process.kill(pid, signal);
  return { ok: true };
}

function hostProcessViewEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.STANLAB_PROCESS_VIEW === 'host' || Boolean(process.env.DASH_HOST_AGENT_SOCKET);
}

async function readProcess(pid: number): Promise<{
  stat: ProcessStat;
  ownerUid: number;
  memoryBytes: number | null;
  io: IoSample;
  name: string;
} | null> {
  try {
    const [statText, statusText, ioText, executable] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'),
      readFile(`/proc/${pid}/status`, 'utf8'),
      readFile(`/proc/${pid}/io`, 'utf8').catch(() => ''),
      readlink(`/proc/${pid}/exe`).catch(() => ''),
    ]);
    const stat = parseStat(statText);
    if (!stat) return null;
    const uidLine = statusText.split('\n').find((line) => line.startsWith('Uid:'));
    const ownerUid = Number(uidLine?.trim().split(/\s+/)[1]);
    if (!Number.isInteger(ownerUid)) return null;
    const rssKb = statusText.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1];
    const io = parseIo(ioText);
    return {
      stat,
      ownerUid,
      memoryBytes: rssKb ? Number(rssKb) * 1024 : null,
      io,
      name: executable ? path.basename(executable.replace(/ \(deleted\)$/, '')) : stat.name,
    };
  } catch {
    return null;
  }
}

function parseStat(text: string): ProcessStat | null {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close <= open) return null;
  const fields = text.slice(close + 1).trim().split(/\s+/);
  if (fields.length < 20) return null;
  try {
    return {
      name: text.slice(open + 1, close),
      state: fields[0],
      parentPid: Number(fields[1]),
      cpuTicks: BigInt(fields[11]) + BigInt(fields[12]),
      startToken: fields[19],
    };
  } catch {
    return null;
  }
}

function parseIo(text: string): IoSample {
  const read = text.match(/^read_bytes:\s+(\d+)/m)?.[1];
  const written = text.match(/^write_bytes:\s+(\d+)/m)?.[1];
  return {
    readBytes: read ? Number(read) : null,
    writeBytes: written ? Number(written) : null,
  };
}

async function readGpuMemoryByPid() {
  const result = new Map<number, number>();
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/nvidia-smi',
      ['--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'],
      { timeout: 1500, maxBuffer: 32_000 },
    );
    for (const line of stdout.split('\n')) {
      const match = line.trim().match(/^(\d+)\s*,\s*(\d+(?:\.\d+)?)/);
      if (match) result.set(Number(match[1]), Number(match[2]) * 1024 * 1024);
    }
  } catch {
    // GPU process memory is optional and is reported as unavailable when NVIDIA telemetry is absent.
  }
  return result;
}

async function getProtectedPids() {
  const protectedPids = new Set<number>([1]);
  let pid: number | undefined = process.pid;
  for (let depth = 0; pid && depth < 16; depth += 1) {
    if (protectedPids.has(pid)) break;
    protectedPids.add(pid);
    const parentStat: ProcessStat | null = await readFile(`/proc/${pid}/stat`, 'utf8').then(parseStat).catch(() => null);
    pid = parentStat?.parentPid;
  }
  return protectedPids;
}

async function loadClockTicks() {
  try {
    const { stdout } = await execFileAsync('/usr/bin/getconf', ['CLK_TCK'], { timeout: 1000 });
    const value = Number(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : 100;
  } catch {
    return 100;
  }
}

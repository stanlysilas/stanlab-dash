import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
let previousCpu = cpuTotals(os.cpus());

function cpuTotals(cpus: ReturnType<typeof os.cpus>) {
  return cpus.reduce((total, cpu) => {
    for (const [key, value] of Object.entries(cpu.times)) total[key as keyof typeof total] += value;
    return total;
  }, { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 });
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export async function getMetrics() {
  const currentCpu = cpuTotals(os.cpus());
  const totalDelta = Object.keys(currentCpu).reduce((sum, key) => sum + currentCpu[key as keyof typeof currentCpu] - previousCpu[key as keyof typeof previousCpu], 0);
  const idleDelta = currentCpu.idle - previousCpu.idle;
  previousCpu = currentCpu;
  const totalMemory = os.totalmem();
  const usedMemory = totalMemory - os.freemem();
  const [disk, gpu] = await Promise.all([readDisk(), readGpu()]);
  return {
    capturedAt: new Date().toISOString(),
    cpu: { percent: percent(Math.max(0, totalDelta - idleDelta), totalDelta), detail: `${os.cpus().length} logical cores` },
    gpu,
    memory: { percent: percent(usedMemory, totalMemory), usedBytes: usedMemory, totalBytes: totalMemory },
    disk,
  };
}

async function readDisk() {
  try {
    const { stdout } = await execFileAsync('/usr/bin/df', ['-Pk', '/'], { timeout: 1500, maxBuffer: 20_000 });
    const fields = stdout.trim().split('\n').at(-1)?.trim().split(/\s+/);
    if (!fields || fields.length < 6) throw new Error('Unexpected df output');
    const totalBytes = Number(fields[1]) * 1024;
    const usedBytes = Number(fields[2]) * 1024;
    return { percent: percent(usedBytes, totalBytes), usedBytes, totalBytes, mount: fields.at(-1) ?? '/' };
  } catch {
    return { percent: null, usedBytes: null, totalBytes: null, mount: '/' };
  }
}

async function readGpu() {
  try {
    const { stdout } = await execFileAsync('/usr/bin/nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.total,name', '--format=csv,noheader,nounits'], { timeout: 1500, maxBuffer: 20_000 });
    const [usage, used, total, ...name] = stdout.trim().split(',').map((part) => part.trim());
    if (![usage, used, total].every((value) => Number.isFinite(Number(value)))) throw new Error('Unexpected nvidia-smi output');
    return { percent: Number(usage), usedBytes: Number(used) * 1024 * 1024, totalBytes: Number(total) * 1024 * 1024, name: name.join(', ') };
  } catch {
    return { percent: null, usedBytes: null, totalBytes: null, name: null };
  }
}

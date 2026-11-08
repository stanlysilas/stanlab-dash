import os from "node:os";
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
let previousCpu = cpuTotals(os.cpus());

function cpuTotals(cpus: ReturnType<typeof os.cpus>) {
  return cpus.reduce(
    (total, cpu) => {
      for (const [key, value] of Object.entries(cpu.times))
        total[key as keyof typeof total] += value;
      return total;
    },
    { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
  );
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export async function getMetrics() {
  const currentCpu = cpuTotals(os.cpus());
  const totalDelta = Object.keys(currentCpu).reduce(
    (sum, key) =>
      sum +
      currentCpu[key as keyof typeof currentCpu] -
      previousCpu[key as keyof typeof previousCpu],
    0,
  );
  const idleDelta = currentCpu.idle - previousCpu.idle;
  previousCpu = currentCpu;
  const totalMemory = os.totalmem();
  const usedMemory = totalMemory - os.freemem();
  const [disk, gpu, cpuTemperatureC] = await Promise.all([
    readDisk(),
    readGpu(),
    readCpuTemperature(),
  ]);
  return {
    capturedAt: new Date().toISOString(),
    cpu: {
      percent: percent(Math.max(0, totalDelta - idleDelta), totalDelta),
      detail: `${os.cpus().length} logical cores`,
      temperatureC: cpuTemperatureC,
    },
    gpu,
    memory: {
      percent: percent(usedMemory, totalMemory),
      usedBytes: usedMemory,
      totalBytes: totalMemory,
    },
    disk,
  };
}

async function readDisk() {
  try {
    const diskPath =
      process.env.STANLAB_DISK_PATH ?? process.env.XDG_DATA_HOME ?? "/";
    const { stdout } = await execFileAsync("/usr/bin/df", ["-Pk", diskPath], {
      timeout: 1500,
      maxBuffer: 20_000,
    });
    const fields = stdout.trim().split("\n").at(-1)?.trim().split(/\s+/);
    if (!fields || fields.length < 6) throw new Error("Unexpected df output");
    const totalBytes = Number(fields[1]) * 1024;
    const usedBytes = Number(fields[2]) * 1024;
    return {
      percent: percent(usedBytes, totalBytes),
      usedBytes,
      totalBytes,
      mount: fields.at(-1) ?? "/",
    };
  } catch {
    return { percent: null, usedBytes: null, totalBytes: null, mount: "/" };
  }
}

async function readGpu() {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/nvidia-smi",
      [
        "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,name",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 1500, maxBuffer: 20_000 },
    );
    const [usage, used, total, temperature, ...name] = stdout
      .trim()
      .split(",")
      .map((part) => part.trim());
    if (![usage, used, total].every((value) => Number.isFinite(Number(value))))
      throw new Error("Unexpected nvidia-smi output");
    return {
      percent: Number(usage),
      usedBytes: Number(used) * 1024 * 1024,
      totalBytes: Number(total) * 1024 * 1024,
      temperatureC: validTemperature(Number(temperature)),
      name: name.join(", "),
    };
  } catch {
    return { percent: null, usedBytes: null, totalBytes: null, temperatureC: null, name: null };
  }
}

async function readCpuTemperature(): Promise<number | null> {
  const candidates: Array<{ value: number; score: number }> = [];
  try {
    const devices = await readdir("/sys/class/hwmon");
    for (const device of devices) {
      const root = `/sys/class/hwmon/${device}`;
      const name = await readFile(`${root}/name`, "utf8").then((value) => value.trim().toLowerCase()).catch(() => "");
      if (!/^(coretemp|k10temp|zenpower|cpu_thermal|cpu|soc_thermal)$/.test(name)) continue;
      const files = await readdir(root).catch(() => []);
      const inputs = files.filter((file) => /^temp\d+_input$/.test(file));
      for (const input of inputs) {
        const raw = Number(await readFile(`${root}/${input}`, "utf8").then((value) => value.trim()).catch(() => "NaN"));
        const value = validTemperature(raw / 1000);
        if (value === null) continue;
        const labelFile = input.replace("_input", "_label");
        const label = await readFile(`${root}/${labelFile}`, "utf8").then((value) => value.trim().toLowerCase()).catch(() => "");
        const score = /package|tdie/.test(label) ? 5 : /tctl/.test(label) ? 4 : /cpu/.test(label) ? 3 : /core/.test(label) ? 2 : 1;
        candidates.push({ value, score });
      }
    }
  } catch {
    // Continue to thermal-zone sensors when hwmon is absent or hidden.
  }
  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].value;
  }

  try {
    const zones = await readdir("/sys/class/thermal");
    const thermalCandidates: Array<{ value: number; score: number }> = [];
    for (const zone of zones.filter((entry) => /^thermal_zone\d+$/.test(entry))) {
      const root = `/sys/class/thermal/${zone}`;
      const type = await readFile(`${root}/type`, "utf8").then((value) => value.trim().toLowerCase()).catch(() => "");
      if (!/cpu|processor|x86_pkg_temp/.test(type)) continue;
      const raw = Number(await readFile(`${root}/temp`, "utf8").then((value) => value.trim()).catch(() => "NaN"));
      const value = validTemperature(raw / 1000);
      if (value !== null) thermalCandidates.push({ value, score: /package|x86_pkg_temp/.test(type) ? 2 : 1 });
    }
    thermalCandidates.sort((a, b) => b.score - a.score);
    return thermalCandidates[0]?.value ?? null;
  } catch {
    // Some systems do not expose thermal sensors in the container.
    return null;
  }
}

function validTemperature(value: number): number | null {
  return Number.isFinite(value) && value >= -10 && value <= 150 ? value : null;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LockKeyhole, Pause, Play, RefreshCw, Search, Square, X } from "lucide-react";
import { api, formatBytes, type ProcessAction, type ProcessList, type RunningProcess } from "../lib/api";
import { Button, Field } from "./ui";

type SortKey = "name" | "cpu" | "gpu" | "memory" | "disk";

export function ProcessMonitor() {
  const [snapshot, setSnapshot] = useState<ProcessList | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("cpu");
  const [descending, setDescending] = useState(true);
  const [busyPid, setBusyPid] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setRefreshing(true);
    try {
      setSnapshot(await api<ProcessList>("/api/processes"));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Process information could not be read.");
    } finally {
      refreshLock.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const rows = useMemo(() => {
    const filtered = (snapshot?.processes ?? []).filter((process) =>
      `${process.name} ${process.pid}`.toLowerCase().includes(query.trim().toLowerCase()),
    );
    const numberFor = (process: RunningProcess) => {
      if (sortKey === "cpu") return process.cpuPercent;
      if (sortKey === "gpu") return process.gpuMemoryBytes;
      if (sortKey === "memory") return process.memoryBytes;
      return (process.diskReadBytesPerSecond ?? 0) + (process.diskWriteBytesPerSecond ?? 0);
    };
    filtered.sort((a, b) => {
      const order = sortKey === "name"
        ? a.name.localeCompare(b.name)
        : (numberFor(a) ?? -1) - (numberFor(b) ?? -1);
      return descending ? -order : order;
    });
    return filtered;
  }, [query, snapshot, sortKey, descending]);

  function changeSort(key: SortKey) {
    if (sortKey === key) setDescending((value) => !value);
    else {
      setSortKey(key);
      setDescending(key !== "name");
    }
  }

  async function act(process: RunningProcess, action: ProcessAction) {
    if (!process.canControl || busyPid !== null) return;
    const actionLabel = action === "terminate" ? "end" : action === "kill" ? "force-kill" : action;
    if ((action === "terminate" || action === "kill") && !window.confirm(`${action === "kill" ? "Force-kill" : "End"} ${process.name} (PID ${process.pid})?`)) return;
    setBusyPid(process.pid);
    setError("");
    try {
      await api(`/api/processes/${process.pid}/action`, {
        method: "POST",
        body: JSON.stringify({ action, startToken: process.startToken }),
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not ${actionLabel} process.`);
      await refresh();
    } finally {
      setBusyPid(null);
    }
  }

  return (
    <section className="dashboard-panel mt-4" aria-label="Running processes">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="dashboard-panel-title">Running processes</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {snapshot?.scope === "host"
              ? `${rows.length} visible · updates every 5 seconds`
              : "Process activity from the system monitor"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative block w-44 sm:w-56">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <Field
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter processes"
              aria-label="Filter processes by name or PID"
              className="h-9 pl-9 text-xs"
            />
          </label>
          <Button variant="ghost" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh processes" className="min-h-9 px-2.5">
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      {snapshot?.scope === "unavailable" ? (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-5 text-sm text-amber-200">
          Host process view is not enabled in this container deployment. Merge <code className="font-mono">docker-compose.process-monitor.yml</code> with your Compose file and recreate Stanlab.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#343940]">
          <table className="w-full min-w-[820px] border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-[#171a1d] text-[10px] uppercase tracking-[0.1em] text-zinc-500">
              <tr>
                <th className="w-[32%] px-4 py-3 font-medium">Process</th>
                <SortHeader label="CPU" active={sortKey === "cpu"} descending={descending} onClick={() => changeSort("cpu")} />
                <SortHeader label="GPU" active={sortKey === "gpu"} descending={descending} onClick={() => changeSort("gpu")} />
                <SortHeader label="Memory" active={sortKey === "memory"} descending={descending} onClick={() => changeSort("memory")} />
                <SortHeader label="Disk" active={sortKey === "disk"} descending={descending} onClick={() => changeSort("disk")} />
                <th className="px-3 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2d3238]">
              {rows.map((process) => {
                const suspended = process.state === "T" || process.state === "t";
                const busy = busyPid === process.pid;
                const permissionTitle = process.canControl
                  ? ""
                  : "Only Stanlab user's processes can be controlled; Stanlab and its parent processes are protected.";
                return (
                  <tr key={`${process.pid}-${process.startToken}`} className="transition hover:bg-white/[0.025]">
                    <td className="max-w-0 px-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className={`size-1.5 shrink-0 rounded-full ${suspended ? "bg-amber-300" : process.state === "R" ? "bg-lime-400" : "bg-zinc-600"}`} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-zinc-200" title={process.name}>{process.name}</div>
                          <div className="mt-0.5 font-mono text-[10px] text-zinc-500">PID {process.pid} · {stateName(process.state)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-zinc-300">{process.cpuPercent === null ? "—" : `${process.cpuPercent.toFixed(1)}%`}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-zinc-300">{process.gpuMemoryBytes === null ? "—" : formatBytes(process.gpuMemoryBytes)}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-zinc-300">{process.memoryBytes === null ? "—" : formatBytes(process.memoryBytes)}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-zinc-400">{formatRate(process.diskReadBytesPerSecond)} ↓ · {formatRate(process.diskWriteBytesPerSecond)} ↑</td>
                    <td className="px-3 py-2 text-right">
                      {process.canControl ? (
                        <div className="flex justify-end gap-1">
                          <ActionButton disabled={busy || busyPid !== null} label={suspended ? "Resume process" : "Suspend process"} onClick={() => void act(process, suspended ? "resume" : "suspend")}>
                            {suspended ? <Play size={14} /> : <Pause size={14} />}
                          </ActionButton>
                          <ActionButton disabled={busy || busyPid !== null} label="End process" onClick={() => void act(process, "terminate")}>
                            <Square size={13} />
                          </ActionButton>
                          <ActionButton disabled={busy || busyPid !== null} label="Force-kill process" onClick={() => void act(process, "kill")}>
                            <X size={15} />
                          </ActionButton>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-600" title={permissionTitle}>
                          <LockKeyhole size={12} />Protected
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                    {snapshot?.scope === "host" ? "No matching processes." : error ? "Could not load processes." : "Loading host process data…"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-500">
        <span>Columns: CPU · GPU memory · resident memory · disk read/write rate.</span>
        <span>Actions are limited to the Stanlab Linux user. End sends SIGTERM; kill sends SIGKILL.</span>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    </section>
  );
}

function SortHeader({ label, active, descending, onClick }: { label: string; active: boolean; descending: boolean; onClick: () => void }) {
  return (
    <th aria-sort={active ? (descending ? "descending" : "ascending") : "none"} className="px-3 py-3 font-medium">
      <button type="button" onClick={onClick} className={`transition hover:text-zinc-200 ${active ? "text-lime-300" : ""}`}>
        {label}{active ? (descending ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
}

function ActionButton({ children, disabled, label, onClick }: { children: React.ReactNode; disabled: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} aria-label={label} title={label} onClick={onClick} className="grid size-8 place-items-center rounded-md border border-white/10 text-zinc-400 transition hover:border-lime-300/40 hover:text-lime-300 disabled:cursor-not-allowed disabled:opacity-30">
      {children}
    </button>
  );
}

function formatRate(value: number | null) {
  return value === null ? "—" : `${formatBytes(value)}/s`;
}

function stateName(state: string) {
  if (state === "R") return "Running";
  if (state === "T" || state === "t") return "Suspended";
  if (state === "Z") return "Zombie";
  if (state === "D") return "Waiting";
  return "Sleeping";
}

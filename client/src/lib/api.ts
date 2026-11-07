export type MetricValue = { percent: number | null; usedBytes: number | null; totalBytes: number | null };
export type Metrics = {
  capturedAt: string;
  cpu: { percent: number; detail: string };
  gpu: MetricValue & { name: string | null };
  memory: MetricValue;
  disk: MetricValue & { mount: string };
};
export type ConfiguredScript = { id: string; label: string; file: string; available: boolean };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: 'same-origin', headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  if (response.status === 401 && url !== '/api/auth/session') window.dispatchEvent(new Event('stanlab:unauthorized'));
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Request failed (${response.status})`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) { amount /= 1024; unitIndex += 1; }
  return `${amount.toFixed(amount >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

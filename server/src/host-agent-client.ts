import http from 'node:http';
import os from 'node:os';

export function proxyToHostAgent(path: string, method: string, res: import('express').Response, body?: unknown) {
  const socketPath = process.env.DASH_HOST_AGENT_SOCKET;
  if (!socketPath) {
    res.status(503).json({ error: 'The Legion host helper is not configured.' });
    return;
  }
  const timeout = path.endsWith('/install') || path.endsWith('/update') ? 11 * 60_000 : path === '/api/scripts/run' ? 35_000 : 15_000;
  const serializedBody = body === undefined || ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(body);
  const upstream = http.request({
    socketPath,
    path,
    method,
    headers: serializedBody ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(serializedBody) } : undefined,
    timeout,
  }, (response) => {
    const chunks: Buffer[] = [];
    let total = 0;
    response.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total <= 128_000) chunks.push(chunk);
      else upstream.destroy(new Error('Host helper response exceeded the size limit.'));
    });
    response.on('end', () => {
      res.status(response.statusCode ?? 502);
      res.type(response.headers['content-type'] ?? 'application/json');
      res.send(Buffer.concat(chunks));
    });
  });
  upstream.on('timeout', () => upstream.destroy(new Error('The Legion host helper did not respond.')));
  upstream.on('error', () => {
    if (!res.headersSent) res.status(503).json({ error: 'The Legion host helper is unavailable.' });
  });
  if (serializedBody) upstream.write(serializedBody);
  upstream.end();
}

export function getHostHostname(): Promise<string> {
  return new Promise((resolve, reject) => {
    const socketPath = process.env.DASH_HOST_AGENT_SOCKET;
    if (!socketPath) return resolve(os.hostname());
    const request = http.get({ socketPath, path: '/api/hostname', timeout: 3_000 }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')).hostname); }
        catch { reject(new Error('The host helper returned an invalid hostname.')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('The host helper did not respond.')));
    request.on('error', reject);
  });
}

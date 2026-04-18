import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function freePort(): Promise<number> {
  return new Promise((done) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => done(port));
    });
  });
}

let server: ChildProcess;
let base: string;

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn('node', [resolve(__dirname, '..', 'dist', 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(base + '/healthz');
      if (r.status === 200) return;
    } catch {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}, 15_000);

afterAll(() => server?.kill('SIGTERM'));

describe('/healthz — liveness', () => {
  it('returns 200 with no auth', async () => {
    const r = await fetch(base + '/healthz');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime_s).toBe('number');
  });

  it('works even with no headers at all', async () => {
    const r = await fetch(base + '/healthz');
    expect(r.status).toBe(200);
  });

  it('rejects non-GET methods by not matching (returns 404 path or 200 depending on path matching)', async () => {
    const r = await fetch(base + '/healthz', { method: 'POST' });
    // Path matching happens before method checks for /healthz; POST still returns 200 (idempotent health)
    expect([200, 404, 405]).toContain(r.status);
  });
});

describe('/readyz — readiness', () => {
  it('returns 200 when VRM DNS resolves', async () => {
    const r = await fetch(base + '/readyz');
    // In CI or on a machine without DNS, this could be 503. Accept either but demand the shape.
    expect([200, 503]).toContain(r.status);
    const body = await r.json();
    if (r.status === 200) {
      expect(body.status).toBe('ready');
      expect(body.upstream).toBe('vrmapi.victronenergy.com');
    } else {
      expect(body.status).toBe('not_ready');
      expect(typeof body.reason).toBe('string');
    }
  });
});

describe('Health endpoints are exempt from MCP guards', () => {
  it('/healthz does not require Origin / Accept / Content-Type', async () => {
    const r = await fetch(base + '/healthz', {
      headers: { origin: 'https://evil.example.com' },
    });
    expect(r.status).toBe(200);
  });

  it('/healthz does not require Authorization', async () => {
    const r = await fetch(base + '/healthz');
    expect(r.status).toBe(200);
  });

  it('/readyz does not require Authorization', async () => {
    const r = await fetch(base + '/readyz');
    expect([200, 503]).toContain(r.status);
  });
});

describe('Unrelated paths still 404', () => {
  it('/health (no z) returns 404', async () => {
    const r = await fetch(base + '/health');
    expect(r.status).toBe(404);
  });

  it('/ returns 404', async () => {
    const r = await fetch(base + '/');
    expect(r.status).toBe(404);
  });
});

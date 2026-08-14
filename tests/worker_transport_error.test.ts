import { describe, it, expect, vi } from 'vitest';

/**
 * Isolated in its own file because it mocks the MCP transport module: a
 * transport that throws from handleRequest must surface as the Worker's
 * 500 internal_error catch-all, never as an unhandled rejection. The SDK
 * transport handles malformed requests itself (see worker.test.ts), so this
 * path is only reachable through a transport-level failure.
 */

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: class {
    onclose?: () => void;
    onerror?: (e: Error) => void;
    onmessage?: (m: unknown) => void;
    async start(): Promise<void> {}
    async close(): Promise<void> {}
    async send(): Promise<void> {}
    async handleRequest(): Promise<Response> {
      throw new Error('transport exploded');
    }
  },
}));

import worker from '../src/worker.js';

describe('Worker fetch handler — transport failure', () => {
  it('a throwing transport surfaces as 500 internal_error', async () => {
    const res = await worker.fetch(
      new Request('http://example.com/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${'x'.repeat(32)}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      {},
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('internal_error');
    expect(body.message).toMatch(/transport exploded/);
  });
});

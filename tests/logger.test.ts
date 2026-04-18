import { describe, it, expect, afterEach, vi } from 'vitest';
import { log } from '../src/logger.js';

describe('logger — JSON to stderr with token redaction', () => {
  const writes: string[] = [];
  const original = process.stderr.write.bind(process.stderr);

  const stub = () => {
    writes.length = 0;
    (process.stderr.write as unknown as typeof process.stderr.write) = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
  };

  afterEach(() => {
    process.stderr.write = original;
    vi.restoreAllMocks();
  });

  it('emits one JSON line per call', () => {
    stub();
    log.info('hello');
    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0].trim());
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(typeof parsed.t).toBe('string');
  });

  it('includes context fields', () => {
    stub();
    log.warn('ev', { host: '127.0.0.1', port: 3000 });
    const parsed = JSON.parse(writes[0]);
    expect(parsed.host).toBe('127.0.0.1');
    expect(parsed.port).toBe(3000);
  });

  it('strips any key containing `token`', () => {
    stub();
    log.info('ev', {
      token: 'eyJabc',
      access_token: 'eyJdef',
      not_sensitive: 'visible',
    });
    const parsed = JSON.parse(writes[0]);
    expect(parsed.token).toBeUndefined();
    expect(parsed.access_token).toBeUndefined();
    expect(parsed.not_sensitive).toBe('visible');
  });

  it('strips any key containing `authorization`', () => {
    stub();
    log.info('ev', {
      authorization: 'Bearer leaked',
      'x-authorization': 'Token leaked',
      msg: 'keep',
    });
    const parsed = JSON.parse(writes[0]);
    expect(parsed.authorization).toBeUndefined();
    expect(parsed['x-authorization']).toBeUndefined();
  });

  it('case-insensitive stripping', () => {
    stub();
    log.info('ev', { ACCESS_TOKEN: 'x', Authorization: 'y' });
    const parsed = JSON.parse(writes[0]);
    expect(parsed.ACCESS_TOKEN).toBeUndefined();
    expect(parsed.Authorization).toBeUndefined();
  });

  it('strips cookie / set-cookie keys', () => {
    stub();
    log.info('ev', { cookie: 'session=abc', 'set-cookie': 'x=y', safe: 'keep' });
    const parsed = JSON.parse(writes[0]);
    expect(parsed.cookie).toBeUndefined();
    expect(parsed['set-cookie']).toBeUndefined();
    expect(parsed.safe).toBe('keep');
  });

  it('strips api-key / apikey / client_secret / credential / password / secret', () => {
    stub();
    log.info('ev', {
      'api-key': 'xxx',
      apikey: 'yyy',
      client_secret: 'zzz',
      my_credential: 'aaa',
      user_password: 'bbb',
      shared_secret: 'ccc',
      message: 'keep',
    });
    const parsed = JSON.parse(writes[0]);
    expect(parsed['api-key']).toBeUndefined();
    expect(parsed.apikey).toBeUndefined();
    expect(parsed.client_secret).toBeUndefined();
    expect(parsed.my_credential).toBeUndefined();
    expect(parsed.user_password).toBeUndefined();
    expect(parsed.shared_secret).toBeUndefined();
    expect(parsed.message).toBe('keep');
  });
});

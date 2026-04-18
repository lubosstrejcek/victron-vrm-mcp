type Level = 'info' | 'warn' | 'error';

const REDACT_SUBSTRINGS = [
  'token',
  'authorization',
  'cookie',
  'api-key',
  'apikey',
  'client_secret',
  'credential',
  'password',
  'secret',
];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  for (const needle of REDACT_SUBSTRINGS) {
    if (k.includes(needle)) {
      return true;
    }
  }
  return false;
}

function write(level: Level, message: string, context?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    t: new Date().toISOString(),
    level,
    msg: message,
  };
  if (context) {
    for (const [k, v] of Object.entries(context)) {
      if (isSensitiveKey(k)) {
        continue;
      }
      entry[k] = v;
    }
  }
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

export const log = {
  info: (message: string, context?: Record<string, unknown>): void => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>): void => write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>): void => write('error', message, context),
};

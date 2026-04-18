const VRM_BASE_URL = 'https://vrmapi.victronenergy.com/v2';
const VRM_ALLOWED_HOST = 'vrmapi.victronenergy.com';

export type VrmAuthScheme = 'Token' | 'Bearer';

export interface VrmErrorBody {
  success: false;
  errors: string;
  error_code: string | null;
}

export class VrmApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;
  public readonly retryAfterSeconds?: number;

  public constructor(status: number, body: unknown, retryAfterSeconds?: number) {
    super(`VRM API ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type QueryValue = string | number | boolean | Array<string | number | boolean>;

export interface VrmDownload {
  contentType: string;
  bytes: number;
  base64: string;
}

export interface VrmClient {
  get<T>(path: string, query?: Record<string, QueryValue | undefined>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  postDownload(path: string, body?: unknown): Promise<VrmDownload>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string, body?: unknown): Promise<T>;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function vrmRequest<T>(
  method: Method,
  path: string,
  token: string,
  scheme: VrmAuthScheme,
  opts?: { query?: Record<string, QueryValue | undefined>; body?: unknown },
): Promise<T> {
  if (!path.startsWith('/')) {
    throw new Error(`VRM path must start with '/': ${path}`);
  }

  const url = new URL(VRM_BASE_URL + path);
  if (url.protocol !== 'https:' || url.host !== VRM_ALLOWED_HOST) {
    throw new Error('VRM client refuses to request a non-VRM host.');
  }
  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined) {
        continue;
      }
      const values = Array.isArray(v) ? v : [v];
      for (const item of values) {
        url.searchParams.append(k, String(item));
      }
    }
  }

  const headers: Record<string, string> = {
    'x-authorization': `${scheme} ${token}`,
    'accept': 'application/json',
  };

  let body: string | undefined;
  if (opts?.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const response = await fetch(url, { method, headers, body });

  if (!response.ok) {
    let errBody: unknown;
    try {
      errBody = await response.json();
    } catch {
      errBody = await response.text();
    }

    let retryAfter: number | undefined;
    if (response.status === 429) {
      const header = response.headers.get('retry-after');
      if (header) {
        const parsed = parseInt(header, 10);
        if (!isNaN(parsed)) {
          retryAfter = parsed;
        }
      }
    }

    throw new VrmApiError(response.status, errBody, retryAfter);
  }

  return response.json() as Promise<T>;
}

async function vrmDownload(
  path: string,
  token: string,
  scheme: VrmAuthScheme,
  body?: unknown,
): Promise<VrmDownload> {
  if (!path.startsWith('/')) {
    throw new Error(`VRM path must start with '/': ${path}`);
  }
  const url = new URL(VRM_BASE_URL + path);
  if (url.protocol !== 'https:' || url.host !== VRM_ALLOWED_HOST) {
    throw new Error('VRM client refuses to request a non-VRM host.');
  }

  const headers: Record<string, string> = {
    'x-authorization': `${scheme} ${token}`,
    'accept': '*/*',
  };
  let reqBody: string | undefined;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    reqBody = JSON.stringify(body);
  }
  const response = await fetch(url, { method: 'POST', headers, body: reqBody });
  if (!response.ok) {
    let errBody: unknown;
    try {
      errBody = await response.json();
    } catch {
      errBody = await response.text();
    }
    const retryAfter =
      response.status === 429 ? parseInt(response.headers.get('retry-after') ?? '', 10) : undefined;
    throw new VrmApiError(response.status, errBody, Number.isFinite(retryAfter) ? retryAfter : undefined);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  return {
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    bytes: buf.byteLength,
    base64: buf.toString('base64'),
  };
}

export function createVrmClient(token: string, scheme: VrmAuthScheme = 'Token'): VrmClient {
  if (!token || token.length < 16) {
    throw new Error('VRM token is missing or implausibly short.');
  }
  return {
    get: (path, query) => vrmRequest('GET', path, token, scheme, { query }),
    post: (path, body) => vrmRequest('POST', path, token, scheme, { body }),
    postDownload: (path, body) => vrmDownload(path, token, scheme, body),
    put: (path, body) => vrmRequest('PUT', path, token, scheme, { body }),
    patch: (path, body) => vrmRequest('PATCH', path, token, scheme, { body }),
    delete: (path, body) => vrmRequest('DELETE', path, token, scheme, { body }),
  };
}

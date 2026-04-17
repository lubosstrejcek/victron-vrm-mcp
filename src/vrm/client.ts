const VRM_BASE_URL = 'https://vrmapi.victronenergy.com/v2';

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

export interface VrmClient {
  get<T>(path: string, query?: Record<string, string | number>): Promise<T>;
}

export function createVrmClient(token: string, scheme: VrmAuthScheme = 'Token'): VrmClient {
  return {
    async get<T>(path: string, query?: Record<string, string | number>): Promise<T> {
      const url = new URL(VRM_BASE_URL + path);
      if (query) {
        for (const [k, v] of Object.entries(query)) {
          url.searchParams.set(k, String(v));
        }
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-authorization': `${scheme} ${token}`,
          'accept': 'application/json',
        },
      });

      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = await response.text();
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

        throw new VrmApiError(response.status, body, retryAfter);
      }

      return response.json() as Promise<T>;
    },
  };
}

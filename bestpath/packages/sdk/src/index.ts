/**
 * Typed HTTP client for the BestPath API.
 *
 * Deliberately thin: it knows the `ApiResponse<T>` envelope and how to send an
 * `Idempotency-Key`, and nothing else. Endpoint methods get added per feature.
 */

import type { ApiResponse } from '@bestpath/shared';

export class ApiError extends Error {
  constructor(
    readonly code: number,
    readonly error: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Extra headers sent with every request, e.g. an auth cookie. */
  headers?: Record<string, string>;
}

export class BestPathClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.headers = options.headers ?? {};
  }

  /** Derive a client bound to a different base, sharing the fetch impl. */
  withHeaders(headers: Record<string, string>): BestPathClient {
    return new BestPathClient({
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
      headers: { ...this.headers, ...headers },
    });
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...this.headers,
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (response.status === 204) return undefined as T;

    const payload = (await response.json()) as ApiResponse<T> | undefined;

    if (!response.ok || !payload) {
      throw new ApiError(
        response.status,
        'unknown_error',
        `Request to ${path} failed with status ${response.status}`,
      );
    }
    if (payload.ok === false) throw new ApiError(payload.code, payload.error, payload.message);
    return payload.data;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>('POST', path, { body, idempotencyKey });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { body });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}

export function createClient(options: ClientOptions): BestPathClient {
  return new BestPathClient(options);
}

// Retry wrapper for SendGrid API calls.
//
// Policy:
//  - Retry on 429 (rate limit) and 5xx (server error)
//  - Honor Retry-After response header when present (seconds or HTTP-date)
//  - Exponential backoff with jitter when no Retry-After is given
//  - Max 3 attempts (1 initial + 2 retries)
//  - NEVER retry on 4xx other than 429 (those are caller bugs, retry won't fix)
//  - NEVER auto-retry on POST creation endpoints — the wrapper accepts
//    `idempotent: false` and immediately rethrows in that case to avoid
//    creating duplicate resources

import { logger } from './logger.js';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  idempotent?: boolean;
}

const DEFAULT_OPTS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  idempotent: true,
};

function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status === 429 || (status >= 500 && status < 600);
}

function parseRetryAfter(headerValue: unknown): number | undefined {
  if (typeof headerValue !== 'string') return undefined;
  // Either a number of seconds or an HTTP-date
  const asNumber = Number(headerValue);
  if (!Number.isNaN(asNumber)) return asNumber * 1000;
  const asDate = Date.parse(headerValue);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
}

function computeBackoffMs(attempt: number, opts: Required<RetryOptions>): number {
  // Exponential with full jitter: random between 0 and min(maxDelay, base * 2^attempt)
  const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTS, ...options };
  let lastErr: any;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status: number | undefined = err?.code ?? err?.response?.statusCode;

      // Non-idempotent operations: never auto-retry. The caller knows the request
      // had side effects (POST create) and a retry could double the resource.
      if (!opts.idempotent) {
        throw err;
      }

      // Non-retryable status (4xx other than 429, or no status at all from a
      // network-layer failure that is too uncertain to retry safely)
      if (!isRetryableStatus(status)) {
        throw err;
      }

      // Last attempt — surface the error
      if (attempt === opts.maxAttempts - 1) {
        throw err;
      }

      const retryAfterMs = parseRetryAfter(
        err?.response?.headers?.['retry-after'] ?? err?.response?.headers?.['Retry-After']
      );
      const delayMs = retryAfterMs ?? computeBackoffMs(attempt, opts);

      logger.warn('retrying SendGrid call', {
        label,
        attempt: attempt + 1,
        maxAttempts: opts.maxAttempts,
        status,
        delayMs,
        retryAfterHeader: retryAfterMs !== undefined,
      });
      await sleep(delayMs);
    }
  }

  throw lastErr;
}

/**
 * The bits every check needs: an HTTP client that speaks as a named seeded user,
 * assertions that read like the acceptance criteria they came from, and a
 * results collector that keeps going after the first failure.
 *
 * A UAT run that stops at the first problem tells the stakeholder one thing.
 * This one tells them everything that is wrong in a single pass, because the
 * point of the pre-flight is to decide whether the demo can happen at all.
 */

export type Role = 'reader' | 'supervisor' | 'admin';

/** The seeded subjects, which are the only identities the dev shim accepts. */
export const SUBS: Record<string, string> = {
  supervisor: 'local-only:jeramehl',
  admin: 'local-only:admin',
  reader: 'local-only:reader1',
  reader2: 'local-only:reader2',
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`${path} → ${status}: ${body.slice(0, 300)}`);
  }
}

export class Api {
  constructor(
    private readonly baseUrl: string,
    private readonly sub: string | null,
  ) {}

  /** The same API as a different seeded user — role checks need both sides. */
  as(sub: string | null): Api {
    return new Api(this.baseUrl, sub);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', ...extra };
    if (this.sub) h['x-dev-user-sub'] = this.sub;
    return h;
  }

  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, { ...init, headers: this.headers() });
  }

  async get<T>(path: string): Promise<T> {
    return this.json<T>(path, { method: 'GET' });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.json<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** The status code alone, for the cases where being refused *is* the result. */
  async status(path: string, init: RequestInit = {}): Promise<number> {
    return (await this.raw(path, init)).status;
  }

  private async json<T>(path: string, init: RequestInit): Promise<T> {
    const res = await this.raw(path, init);
    if (!res.ok) throw new HttpError(res.status, path, await res.text());
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

// ── assertions ───────────────────────────────────────────────────────────────

export class Failed extends Error {}

export function check(what: string, condition: boolean, detail?: string): void {
  if (!condition) throw new Failed(detail ? `${what} — ${detail}` : what);
}

export function equal<T>(what: string, actual: T, expected: T): void {
  check(what, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);
}

export function includes(what: string, haystack: readonly string[], needle: string): void {
  check(what, haystack.includes(needle), `${needle} not in [${haystack.join(', ')}]`);
}

/** Asserts the call is refused with `status`, and that it was not simply broken. */
export async function refuses(what: string, status: number, call: () => Promise<unknown>) {
  try {
    await call();
  } catch (err) {
    if (err instanceof HttpError) return equal(what, err.status, status);
    throw err;
  }
  throw new Failed(`${what} — expected ${status}, but the call succeeded`);
}

// ── scenarios ────────────────────────────────────────────────────────────────

export interface Scenario {
  /** Reads as an acceptance criterion, because that is what it is. */
  name: string;
  /** The decision record or spec section this exists to hold up. */
  cites?: string;
  run(api: Api): Promise<void>;
}

export interface Outcome {
  name: string;
  cites?: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export async function runScenarios(api: Api, scenarios: Scenario[]): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const s of scenarios) {
    const started = Date.now();
    try {
      await s.run(api);
      out.push({ name: s.name, cites: s.cites, ok: true, ms: Date.now() - started });
      process.stdout.write(`  [32m✓[0m ${s.name}\n`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      out.push({ name: s.name, cites: s.cites, ok: false, ms: Date.now() - started, error });
      process.stdout.write(`  [31m✗[0m ${s.name}\n      ${error}\n`);
    }
  }
  return out;
}

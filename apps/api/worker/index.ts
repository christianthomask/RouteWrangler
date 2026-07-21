import { Container, getContainer, type ContainerOptions } from '@cloudflare/containers';

/**
 * Cloudflare Containers wrapper for the NestJS API (ADR-019). A thin Worker
 * routes every request to the container instance, which runs the unmodified Nest
 * server on port 3001. Scales to zero after idle.
 *
 * Cloudflare does NOT auto-inject the Worker's `vars`/secrets into the container
 * process — they live on the Worker's `env`. We forward every string-valued
 * binding into the container so the Nest app's boot-time env validation
 * (config/env.ts: DATABASE_URL, AUTH_PROVIDER, OIDC_*, S3_*, …) sees them. The
 * `API_CONTAINER` Durable Object binding is an object, so the string filter
 * skips it; new secrets are forwarded automatically.
 */
export class ApiContainer extends Container<Env> {
  defaultPort = 3001;
  sleepAfter = '15m';

  constructor(ctx: DurableObjectState, env: Env, options?: ContainerOptions) {
    super(ctx, env, options);
    const envVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
      if (typeof value === 'string') envVars[key] = value;
    }
    this.envVars = envVars;
  }
}

interface Env {
  API_CONTAINER: DurableObjectNamespace<ApiContainer>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // One shared instance; scale out by keying getContainer() per-tenant later.
    return getContainer(env.API_CONTAINER).fetch(request);
  },
};

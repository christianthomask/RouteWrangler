import { Container, getContainer } from '@cloudflare/containers';

/**
 * Cloudflare Containers wrapper for the NestJS API (ADR-019). A thin Worker
 * routes every request to the container instance, which runs the unmodified Nest
 * server on port 3001. Scales to zero after idle.
 *
 * NOTE: Cloudflare Containers is beta and this path is NOT yet verified against a
 * live account (the Claude Code session can't reach Cloudflare). Finalize/deploy
 * from a local Claude Code instance (Cloudflare MCP + `wrangler login`) or via
 * the deploy workflow. Fallback: host this same image on Fly/Render and point
 * the web app's NEXT_PUBLIC_API_BASE_URL at it — see docs/runbook.md.
 */
export class ApiContainer extends Container {
  defaultPort = 3001;
  sleepAfter = '15m';
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

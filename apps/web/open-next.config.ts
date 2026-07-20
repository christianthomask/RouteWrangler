import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Default OpenNext → Cloudflare Workers config (ADR-019). Add caching (KV/R2
// incremental cache) here later if ISR is introduced.
export default defineCloudflareConfig();

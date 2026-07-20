import { z } from 'zod';

/** Catalog for the assign picker (BUILD_SPEC §7.3, §7.5). */
export const ClientSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  state: z.string(),
});
export type ClientSummary = z.infer<typeof ClientSummarySchema>;

export const ClientListResponseSchema = z.object({ clients: z.array(ClientSummarySchema) });
export type ClientListResponse = z.infer<typeof ClientListResponseSchema>;

export const AssignableRouteSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  clientName: z.string(),
  name: z.string(),
  active: z.boolean(),
  stopCount: z.number().int(),
  /** True if a run for this route already exists in the target cycle. */
  assignedThisCycle: z.boolean(),
});
export type AssignableRoute = z.infer<typeof AssignableRouteSchema>;

export const RouteListResponseSchema = z.object({ routes: z.array(AssignableRouteSchema) });
export type RouteListResponse = z.infer<typeof RouteListResponseSchema>;

// ── requests ────────────────────────────────────────────────────────────────
/** Assign a reader to a route → materializes a dated run (W1). */
export const AssignRunRequestSchema = z.object({
  routeId: z.string().uuid(),
  readerId: z.string().uuid(),
  runDate: z.string().optional(), // yyyy-mm-dd, defaults to today
  cycleId: z.string().optional(), // defaults to YYYY-MM of runDate
});
export type AssignRunRequest = z.infer<typeof AssignRunRequestSchema>;

/** Reassign a run's reader — allowed only before the run starts (W1). */
export const ReassignRequestSchema = z.object({ readerId: z.string().uuid() });
export type ReassignRequest = z.infer<typeof ReassignRequestSchema>;

/** Carve a contiguous range of *pending* stops into a new run (ADR-005). */
export const SplitRequestSchema = z.object({
  toReaderId: z.string().uuid(),
  stopIds: z.array(z.string().uuid()).min(1),
});
export type SplitRequest = z.infer<typeof SplitRequestSchema>;

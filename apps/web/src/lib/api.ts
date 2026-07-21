'use client';

import {
  ClientListResponseSchema,
  DashboardSchema,
  ExceptionDetailSchema,
  ExceptionListResponseSchema,
  ExportCyclesResponseSchema,
  ExportListResponseSchema,
  ExportPreviewSchema,
  ExportRunViewSchema,
  FieldMeterReadsResponseSchema,
  MeResponseSchema,
  MeterHistoryResponseSchema,
  RereadTasksResponseSchema,
  RosterResponseSchema,
  RouteListResponseSchema,
  RunDetailSchema,
  RunListResponseSchema,
  TaxonomyResponseSchema,
  type AssignRunRequest,
  type Dashboard,
  type ExceptionDetail,
  type ExceptionFilters,
  type ExceptionListResponse,
  type MeResponse,
  type MeterHistoryResponse,
  type ReassignRequest,
  type ResolveRequest,
  type RunDetail,
  type RunStatus,
  type SplitRequest,
  type TaxonomyResponse,
} from '@routewrangler/contracts';
import type { z } from 'zod';
import { config } from './config';
import { authHeaders } from './session';

/** Server-side filters for `GET /runs` (supervisor/admin only, bar readerId). */
export type RunFilters = {
  readerId?: string;
  status?: RunStatus;
  unassigned?: boolean;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const headers = authHeaders();
  if (!headers) throw new ApiError(401, 'not signed in');

  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...headers, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new ApiError(res.status, `${init?.method ?? 'GET'} ${path} → ${res.status}`);
  }
  return schema.parse(await res.json());
}

export const fetchMe = () => request('/me', MeResponseSchema);
export const fetchTaxonomy = () => request('/taxonomy', TaxonomyResponseSchema);
export const fetchDashboard = () => request('/dashboard', DashboardSchema);

export function fetchExceptions(filters: ExceptionFilters = {}): Promise<ExceptionListResponse> {
  const qs = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  ).toString();
  return request(`/exceptions${qs ? `?${qs}` : ''}`, ExceptionListResponseSchema);
}

export const fetchExceptionDetail = (id: string) =>
  request(`/exceptions/${id}`, ExceptionDetailSchema);

export const fetchMeterHistory = (id: string) =>
  request(`/meters/${id}/history`, MeterHistoryResponseSchema);

const action = (id: string, verb: string, body: unknown): Promise<ExceptionDetail> =>
  request(`/exceptions/${id}/${verb}`, ExceptionDetailSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const orderReread = (id: string, note?: string) => action(id, 'reread', { note });
export const overrideException = (id: string, req: ResolveRequest) => action(id, 'override', req);
export const resolveException = (id: string, req: ResolveRequest) => action(id, 'resolve', req);
export const escalateException = (id: string, note: string) => action(id, 'escalate', { note });

// ── roster / assignment ─────────────────────────────────────────────────────
export const fetchRoster = () => request('/roster', RosterResponseSchema);
export const fetchClients = () => request('/clients', ClientListResponseSchema);
export function fetchRoutes(clientId?: string) {
  return request(`/routes${clientId ? `?clientId=${clientId}` : ''}`, RouteListResponseSchema);
}
export const fetchRun = (id: string) => request(`/runs/${id}`, RunDetailSchema);
export const fetchRereadTasks = () => request('/reread-tasks', RereadTasksResponseSchema);
export const fetchFieldMeterReads = (meterId: string) =>
  request(`/field/meters/${meterId}/reads`, FieldMeterReadsResponseSchema);
/**
 * Run list. Readers get their own runs; supervisors/admins may filter by
 * reader/status, or ask for the unassigned pool (`unassigned: true`).
 */
export function fetchRuns(filters: RunFilters = {}) {
  const params = new URLSearchParams();
  if (filters.readerId) params.set('readerId', filters.readerId);
  if (filters.status) params.set('status', filters.status);
  if (filters.unassigned) params.set('unassigned', 'true');
  const qs = params.toString();
  return request(`/runs${qs ? `?${qs}` : ''}`, RunListResponseSchema);
}
export const assignRun = (req: AssignRunRequest): Promise<RunDetail> =>
  request('/runs', RunDetailSchema, { method: 'POST', body: JSON.stringify(req) });
/** Reassign a run; `readerId: null` releases it back to the unassigned pool. */
export const reassignRun = (id: string, readerId: string | null): Promise<RunDetail> =>
  request(`/runs/${id}/reassign`, RunDetailSchema, { method: 'POST', body: JSON.stringify({ readerId } satisfies ReassignRequest) });
export const splitRun = (id: string, req: SplitRequest): Promise<RunDetail> =>
  request(`/runs/${id}/split`, RunDetailSchema, { method: 'POST', body: JSON.stringify(req) });

// ── billing exports (W4) ─────────────────────────────────────────────────────
export const fetchExportCycles = (clientId: string) =>
  request(`/exports/cycles?clientId=${clientId}`, ExportCyclesResponseSchema);
export const fetchExportPreview = (clientId: string, cycleId: string) =>
  request(`/exports/preview?clientId=${clientId}&cycleId=${encodeURIComponent(cycleId)}`, ExportPreviewSchema);
export function fetchExports(clientId?: string) {
  return request(`/exports${clientId ? `?clientId=${clientId}` : ''}`, ExportListResponseSchema);
}
export const runExport = (clientId: string, cycleId: string) =>
  request('/exports', ExportRunViewSchema, { method: 'POST', body: JSON.stringify({ clientId, cycleId }) });

/** Download a stored export file (authenticated) and save it in the browser. */
export async function downloadExport(id: string, filename: string): Promise<void> {
  const headers = authHeaders();
  if (!headers) throw new ApiError(401, 'not signed in');
  const res = await fetch(`${config.apiBaseUrl}/exports/${id}/download`, { headers });
  if (!res.ok) throw new ApiError(res.status, `download ${id} → ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type { Dashboard, ExceptionDetail, ExceptionListResponse, MeResponse, MeterHistoryResponse, TaxonomyResponse };

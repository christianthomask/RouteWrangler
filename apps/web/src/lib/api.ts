'use client';

import {
  ClientListResponseSchema,
  DashboardSchema,
  ExceptionDetailSchema,
  ExceptionListResponseSchema,
  MeResponseSchema,
  MeterHistoryResponseSchema,
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
  type ResolveRequest,
  type RunDetail,
  type SplitRequest,
  type TaxonomyResponse,
} from '@routewrangler/contracts';
import type { z } from 'zod';
import { config } from './config';
import { authHeaders } from './session';

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
export function fetchRuns(readerId?: string) {
  return request(`/runs${readerId ? `?readerId=${readerId}` : ''}`, RunListResponseSchema);
}
export const assignRun = (req: AssignRunRequest): Promise<RunDetail> =>
  request('/runs', RunDetailSchema, { method: 'POST', body: JSON.stringify(req) });
export const reassignRun = (id: string, readerId: string): Promise<RunDetail> =>
  request(`/runs/${id}/reassign`, RunDetailSchema, { method: 'POST', body: JSON.stringify({ readerId }) });
export const splitRun = (id: string, req: SplitRequest): Promise<RunDetail> =>
  request(`/runs/${id}/split`, RunDetailSchema, { method: 'POST', body: JSON.stringify(req) });

export type { Dashboard, ExceptionDetail, ExceptionListResponse, MeResponse, MeterHistoryResponse, TaxonomyResponse };

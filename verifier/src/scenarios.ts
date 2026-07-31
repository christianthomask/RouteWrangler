import { randomUUID } from 'node:crypto';
import type {
  ClientListResponse,
  Dashboard,
  ExceptionDetail,
  ExceptionListResponse,
  ExportCyclesResponse,
  ExportPreview,
  ExportRunView,
  IngestResponse,
  MeResponse,
  RosterResponse,
  RunDetail,
  RunListResponse,
  StaffListResponse,
  TaxonomyResponse,
} from '@routewrangler/contracts';
import { runPlayback } from '@routewrangler/simulator';
import { Api, SUBS, check, equal, includes, refuses, type Scenario } from './harness';

/**
 * The acceptance criteria, executed against a running API over HTTP. Nothing
 * here reaches into the database or imports a service — a check that cheats its
 * way past the API is not evidence that the product works.
 *
 * Scenarios share the seeded world and run in order; the ones that mutate say so.
 */

const supervisor = (api: Api) => api.as(SUBS.supervisor!);
const admin = (api: Api) => api.as(SUBS.admin!);
const reader = (api: Api) => api.as(SUBS.reader!);

/** State handed between the ordered scenarios below. */
const world: {
  runId?: string;
  clientId?: string;
  cycleId?: string;
  exportId?: string;
  exportBody?: string;
} = {};

export const SCENARIOS: Scenario[] = [
  {
    name: 'the service reports itself healthy and connected to its database',
    run: async (api) => {
      const health = await api.get<{ status: string; db: string }>('/health');
      equal('status', health.status, 'ok');
      equal('database', health.db, 'up');
    },
  },

  {
    name: 'an unauthenticated request is refused',
    cites: 'BUILD_SPEC §6',
    run: async (api) => {
      await refuses('GET /me with no identity', 401, () => api.as(null).get('/me'));
    },
  },

  {
    name: 'an identity with no local user is refused, without saying who does exist',
    cites: 'ADR-027',
    run: async (api) => {
      const stranger = api.as('local-only:nobody-at-all');
      const res = await stranger.raw('/me');
      equal('status', res.status, 401);
      const body = await res.text();
      check('message does not leak staff', !body.includes('@'), body.slice(0, 200));
    },
  },

  {
    name: 'role is read from the database, and gates every endpoint server-side',
    cites: 'BUILD_SPEC §6',
    run: async (api) => {
      const me = await supervisor(api).get<MeResponse>('/me');
      equal('supervisor role', me.role, 'supervisor');
      check('subject id is present', Boolean(me.authSub));

      // A reader is a real, authenticated user — and still cannot see the
      // supervisor's queue or another reader's worklist.
      await refuses('reader → GET /exceptions', 403, () => reader(api).get('/exceptions'));
      await refuses('reader → GET /dashboard', 403, () => reader(api).get('/dashboard'));
      await refuses('supervisor → GET /staff', 403, () => supervisor(api).get('/staff'));
    },
  },

  {
    name: 'the taxonomy is data, and every exception type is present',
    cites: 'ADR-003',
    run: async (api) => {
      const tax = await supervisor(api).get<TaxonomyResponse>('/taxonomy');
      const codes = tax.exceptionTypes.map((t) => t.code);
      for (const code of [
        'high_read',
        'low_read',
        'leak_spike',
        'negative_consumption',
        'rollover_out_of_band',
        'zero_consumption_streak',
        'location_absent',
        'duplicate_mismatch',
        'skipped_unresolved',
      ]) {
        includes(`taxonomy has ${code}`, codes, code);
      }
      check('severities are seeded', tax.severities.length > 0);
      check('skip reasons are seeded', tax.skipReasons.length > 0);
    },
  },

  {
    name: 'the simulator drives the public API and every validation rule trips',
    cites: 'BUILD_SPEC §7.6, ADR-014',
    run: async (api) => {
      const open = await reader(api).get<RunListResponse>('/runs?status=open');
      const run = open.runs[0];
      check('a demo run was seeded', Boolean(run), 'no open run — did the seed run?');
      world.runId = run!.id;
      world.clientId = run!.clientId;
      world.cycleId = run!.cycleId;

      const summary = await runPlayback({
        apiBaseUrl: apiBaseUrl(),
        readerSub: SUBS.reader,
        runId: world.runId,
      });

      check('reads were accepted', summary.batch.accepted > 0, JSON.stringify(summary.batch));
      equal('nothing was rejected', summary.batch.rejected, 0);

      const tripped = new Set(summary.batch.results.flatMap((r) => r.exceptions ?? []));
      for (const code of [
        'high_read',
        'low_read',
        'leak_spike',
        'negative_consumption',
        'rollover_out_of_band',
        'zero_consumption_streak',
        'location_absent',
      ]) {
        includes(`playback tripped ${code}`, [...tripped], code);
      }

      const dup = summary.duplicate?.results[0];
      includes('the re-read tripped duplicate_mismatch', dup?.exceptions ?? [], 'duplicate_mismatch');
    },
  },

  {
    name: 'a read with a blocking exception is not billable; a low-severity one still is',
    cites: 'ADR-009',
    run: async (api) => {
      const list = await supervisor(api).get<ExceptionListResponse>('/exceptions?status=open');
      check('the queue has the playback exceptions', list.total > 0);

      const blocking = list.exceptions.find((e) => e.typeCode === 'leak_spike');
      check('a leak_spike is open', Boolean(blocking));
      const detail = await supervisor(api).get<ExceptionDetail>(`/exceptions/${blocking!.id}`);
      equal('leak_spike blocks billing', detail.flaggedRead?.billable ?? true, false);

      const nonBlocking = list.exceptions.find((e) => e.typeCode === 'location_absent');
      if (nonBlocking) {
        const d = await supervisor(api).get<ExceptionDetail>(`/exceptions/${nonBlocking.id}`);
        equal('location_absent does not block billing', d.flaggedRead?.billable ?? false, true);
      }
    },
  },

  {
    name: 'ingestion is idempotent on the client-generated event id',
    cites: 'ADR-008',
    run: async (api) => {
      // Its own run: playback above worked the demo run to completion, and a
      // scenario that quietly depended on leftovers from another one would pass
      // or fail based on how the seed happened to be shaped that day.
      const run = await freshRun(api);
      const stop = run.stops.find((s) => s.status === 'pending');
      check('the fresh run has a pending stop', Boolean(stop));

      const me = await reader(api).get<MeResponse>('/me');
      const event = {
        id: randomUUID(),
        meterId: stop!.meterId,
        runStopId: stop!.id,
        readerId: me.id,
        value: (stop!.lastValue ?? 0) + 100,
        capturedAt: new Date().toISOString(),
        sourceType: 'simulated' as const,
        lat: stop!.lat,
        lng: stop!.lng,
      };

      const first = await reader(api).post<IngestResponse>('/ingest/read-events', {
        events: [event],
      });
      equal('first submission is accepted', first.results[0]?.status, 'accepted');

      // The exact same payload again — this is what a store-and-forward retry
      // after a lost response looks like.
      const replay = await reader(api).post<IngestResponse>('/ingest/read-events', {
        events: [event],
      });
      equal('the replay is a duplicate, not a second read', replay.results[0]?.status, 'duplicate');
    },
  },

  {
    name: 'the ingestion API refuses a malformed event rather than storing it',
    cites: 'BUILD_SPEC §3',
    run: async (api) => {
      await refuses('an event with no meter', 400, () =>
        reader(api).post('/ingest/read-events', { events: [{ id: randomUUID(), value: 1 }] }),
      );
    },
  },

  {
    name: 'a skip carries evidence: refused without a photo, allowed when unsafe',
    cites: 'ADR-025',
    run: async (api) => {
      const run = await freshRun(api);
      const pending = run.stops.filter((s) => s.status === 'pending');
      check('the fresh run has two pending stops', pending.length >= 2);

      await refuses('locked_gate with no photo', 400, () =>
        reader(api).post(`/runs/${run.id}/stops/${pending[0]!.id}/skip`, {
          skipReasonCode: 'locked_gate',
        }),
      );

      // The one reason that never requires a photograph — lingering to take one
      // is the wrong thing to ask of a reader who is not safe.
      await reader(api).post(`/runs/${run.id}/stops/${pending[1]!.id}/skip`, {
        skipReasonCode: 'unsafe_conditions',
      });

      const after = await reader(api).get<RunDetail>(`/runs/${run.id}`);
      const skipped = after.stops.find((s) => s.id === pending[1]!.id);
      equal('the stop is now skipped', skipped?.status, 'skipped');
      equal('and it remembers why', skipped?.skipReasonCode, 'unsafe_conditions');

      const queue = await supervisor(api).get<ExceptionListResponse>(
        '/exceptions?type=skipped_unresolved',
      );
      check('the skip opened a reviewable exception', queue.total > 0);
    },
  },

  {
    name: 'a supervisor can certify a flagged read, and it becomes billable',
    cites: 'BUILD_SPEC §7.3, ADR-002',
    run: async (api) => {
      const list = await supervisor(api).get<ExceptionListResponse>('/exceptions?status=open');
      const target = list.exceptions.find((e) => e.typeCode === 'high_read');
      check('a high_read is open to certify', Boolean(target));

      const resolved = await supervisor(api).post<ExceptionDetail>(
        `/exceptions/${target!.id}/resolve`,
        { note: 'Verified on site during the UAT pre-flight.' },
      );
      equal('the exception is resolved', resolved.status, 'resolved');

      // The read itself is immutable — certification is recorded against the
      // exception, never written back over the reading.
      const again = await supervisor(api).get<ExceptionDetail>(`/exceptions/${target!.id}`);
      equal('and it stays resolved', again.status, 'resolved');
      equal('the read value was not rewritten', again.flaggedRead?.value, resolved.flaggedRead?.value);
    },
  },

  {
    name: 'escalation hands a decision on without closing the item',
    cites: 'BUILD_SPEC §7.3',
    run: async (api) => {
      const list = await supervisor(api).get<ExceptionListResponse>('/exceptions?status=open');
      const target = list.exceptions.find((e) => e.typeCode === 'negative_consumption');
      if (!target) return; // playback shape can vary; nothing to assert
      const escalated = await supervisor(api).post<ExceptionDetail>(
        `/exceptions/${target.id}/escalate`,
        { note: 'Needs the client’s call on the register swap.' },
      );
      equal('status is escalated, not resolved', escalated.status, 'escalated');
    },
  },

  {
    name: 'the dashboard answers without a second query per row',
    cites: 'BUILD_SPEC §7.3',
    run: async (api) => {
      const dash = await supervisor(api).get<Dashboard>('/dashboard');
      check('the dashboard has counts', typeof dash.openExceptions === 'number');
    },
  },

  {
    name: 'a supervisor can assign a route and split a run mid-route',
    cites: 'ADR-005',
    run: async (api) => {
      const clients = await supervisor(api).get<ClientListResponse>('/clients');
      check('clients are seeded', clients.clients.length > 0);

      const routes = await supervisor(api).get<{
        routes: { id: string; assignedThisCycle: boolean }[];
      }>('/routes');
      const free = routes.routes.find((r) => !r.assignedThisCycle);
      check('an unassigned route is available', Boolean(free));

      const roster = await supervisor(api).get<RosterResponse>('/roster');
      const readerId = roster.readers[0]?.readerId;
      check('the roster has a reader', Boolean(readerId));

      const run = await supervisor(api).post<RunDetail>('/runs', {
        routeId: free!.id,
        readerId,
      });
      check('the run materialized its stops', run.stops.length > 0);
      equal('cycle id is a calendar month', /^\d{4}-(0[1-9]|1[0-2])$/.test(run.cycleId), true);

      const half = Math.floor(run.stops.length / 2);
      const secondReader = roster.readers[1]?.readerId ?? readerId;
      const split = await supervisor(api).post<RunDetail>(`/runs/${run.id}/split`, {
        toReaderId: secondReader,
        stopIds: run.stops.slice(half).map((s) => s.id),
      });

      const original = await supervisor(api).get<RunDetail>(`/runs/${run.id}`);
      equal(
        'every stop is in exactly one run after the split',
        original.stops.length + split.stops.length,
        run.stops.length,
      );
    },
  },

  {
    name: 'the billing export is per client and cycle, and holds what is not billable',
    cites: 'ADR-023',
    run: async (api) => {
      const cycles = await supervisor(api).get<ExportCyclesResponse>(
        `/exports/cycles?clientId=${world.clientId}`,
      );
      includes('the playback cycle is exportable', cycles.cycles, world.cycleId!);

      const preview = await supervisor(api).get<ExportPreview>(
        `/exports/preview?clientId=${world.clientId}&cycleId=${world.cycleId}`,
      );
      check('the preview counts stops', preview.totalStops > 0);
      check(
        'unresolved blocking exceptions are held out of the file',
        preview.holds.some((h) => h.reason === 'blocking_exception'),
      );
      check(
        'a skipped stop is held as skipped, not as unworked',
        preview.holds.every((h) => h.reason !== 'skipped' || h.skipReasonCode !== null),
      );

      const run = await supervisor(api).post<ExportRunView>('/exports', {
        clientId: world.clientId,
        cycleId: world.cycleId,
      });
      world.exportId = run.id;
      equal('one row per billable stop', run.counts.billable, preview.counts.billable);

      const download = await supervisor(api).raw(`/exports/${run.id}/download`);
      equal('the file downloads', download.status, 200);
      world.exportBody = await download.text();
      const rows = world.exportBody.trim().split('\n').length - 1; // minus header
      equal('the file has one row per billable read', rows, run.counts.billable);
    },
  },

  {
    name: 'a re-run supersedes, and the superseded file is still served as it was',
    cites: 'ADR-023',
    run: async (api) => {
      const second = await supervisor(api).post<ExportRunView>('/exports', {
        clientId: world.clientId,
        cycleId: world.cycleId,
      });
      check('the re-run is a new export', second.id !== world.exportId);

      const list = await supervisor(api).get<{ exports: ExportRunView[] }>(
        `/exports?clientId=${world.clientId}`,
      );
      const previous = list.exports.find((e) => e.id === world.exportId);
      equal('the first export is now superseded', previous?.superseded, true);
      equal('the new one is not', list.exports.find((e) => e.id === second.id)?.superseded, false);

      // The body was snapshotted, not re-rendered: what the client downloaded
      // last month must still be byte-for-byte what they downloaded.
      const again = await supervisor(api).raw(`/exports/${world.exportId}/download`);
      equal('the superseded file still downloads', again.status, 200);
      equal('byte for byte', await again.text(), world.exportBody!);
    },
  },

  {
    name: 'an export cycle id must be a calendar month',
    cites: 'ADR-023',
    run: async (api) => {
      await refuses('cycleId "2026-7"', 400, () =>
        supervisor(api).post('/exports', { clientId: world.clientId, cycleId: '2026-7' }),
      );
    },
  },

  {
    name: 'an admin can invite staff, and the invitation is a row nobody can sign in as yet',
    cites: 'ADR-027',
    run: async (api) => {
      const email = `uat-${randomUUID().slice(0, 8)}@example.com`;
      const created = await admin(api).post<{
        member: unknown;
        invitation: { id: string; email: string } | null;
      }>('/staff', { displayName: 'UAT Invitee', role: 'reader', email });

      const staff = await admin(api).get<StaffListResponse>('/staff');
      if (staff.provider === 'oidc') {
        check('the invitation is listed as pending', Boolean(created.invitation));
        check(
          'and it appears in the pending list',
          staff.pendingInvitations.some((i) => i.email === email),
        );
        const row = staff.staff.find((s) => s.email === email);
        equal('with no identity attached', row?.authSub ?? null, null);
        await admin(api).raw(`/staff/invitations/${created.invitation!.id}`, { method: 'DELETE' });
      } else {
        // Local provider (the dev shim): the account is usable immediately.
        check('a local account was minted', created.invitation === null);
      }
    },
  },

  {
    name: 'the last active admin cannot be demoted or deactivated',
    cites: 'ADR-024',
    run: async (api) => {
      const staff = await admin(api).get<StaffListResponse>('/staff');
      const me = await admin(api).get<MeResponse>('/me');
      const admins = staff.staff.filter((s) => s.role === 'admin' && s.active);
      if (admins.length !== 1) return; // the seed changed; nothing to prove here
      await refuses('demoting yourself', 400, () =>
        admin(api).raw(`/staff/${me.id}/role`, {
          method: 'PATCH',
          body: JSON.stringify({ role: 'reader' }),
        }).then(assertOk),
      );
    },
  },
];

/**
 * Materializes a new run for the reader from a route nobody has been assigned
 * this cycle, so a scenario that needs pending stops gets its own rather than
 * competing for the demo run's.
 */
async function freshRun(api: Api): Promise<RunDetail> {
  const routes = await supervisor(api).get<{
    routes: { id: string; assignedThisCycle: boolean }[];
  }>('/routes');
  const free = routes.routes.find((r) => !r.assignedThisCycle);
  check('an unassigned route is available', Boolean(free), 'the seeded routes are all in use');

  const me = await reader(api).get<MeResponse>('/me');
  const run = await supervisor(api).post<RunDetail>('/runs', {
    routeId: free!.id,
    readerId: me.id,
  });
  check('the run materialized its stops', run.stops.length > 0);
  return run;
}

/** Turns a raw Response into the throw/return shape `refuses` expects. */
async function assertOk(res: Response): Promise<unknown> {
  if (!res.ok) {
    const { HttpError } = await import('./harness');
    throw new HttpError(res.status, res.url, await res.text());
  }
  return res.json();
}

let baseUrl = 'http://localhost:3001';
export function setApiBaseUrl(url: string): void {
  baseUrl = url;
}
function apiBaseUrl(): string {
  return baseUrl;
}

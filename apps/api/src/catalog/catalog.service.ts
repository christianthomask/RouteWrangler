import { Inject, Injectable } from '@nestjs/common';
import { asc, count, eq } from 'drizzle-orm';
import type { AssignableRoute, ClientSummary } from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { clients, routeRuns, routes, routeStops } from '../db/schema';

export function currentCycleId(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Clients + assignable routes for the assignment picker (BUILD_SPEC §7.3/§7.5). */
@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async clients(): Promise<ClientSummary[]> {
    return this.db
      .select({ id: clients.id, name: clients.name, state: clients.state })
      .from(clients)
      .orderBy(asc(clients.name));
  }

  async routes(clientId?: string, cycleId = currentCycleId()): Promise<AssignableRoute[]> {
    const routeRows = await this.db
      .select({
        id: routes.id,
        clientId: routes.clientId,
        clientName: clients.name,
        name: routes.name,
        active: routes.active,
      })
      .from(routes)
      .innerJoin(clients, eq(routes.clientId, clients.id))
      .where(clientId ? eq(routes.clientId, clientId) : undefined)
      .orderBy(asc(clients.name), asc(routes.name));

    const stopCounts = new Map(
      (await this.db.select({ routeId: routeStops.routeId, n: count() }).from(routeStops).groupBy(routeStops.routeId)).map(
        (x) => [x.routeId, x.n],
      ),
    );
    const assigned = new Set(
      (
        await this.db
          .select({ routeId: routeRuns.routeId })
          .from(routeRuns)
          .where(eq(routeRuns.cycleId, cycleId))
      ).map((x) => x.routeId),
    );

    return routeRows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      clientName: r.clientName,
      name: r.name,
      active: r.active,
      stopCount: stopCounts.get(r.id) ?? 0,
      assignedThisCycle: assigned.has(r.id),
    }));
  }
}

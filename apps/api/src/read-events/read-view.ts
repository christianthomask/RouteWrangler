import { eq } from 'drizzle-orm';
import type { ReadEventView } from '@routewrangler/contracts';
import type { Database } from '../db/client';
import { readEvents, users } from '../db/schema';
import type { StoragePort } from '../storage/storage.port';

/** Presigned photo URLs are short-lived; the client uses them immediately. */
export const PHOTO_URL_TTL = 300;

/**
 * Maps a stored read to its API view.
 *
 * Lives here because the exceptions and meters services each had their own copy
 * and they drifted — adding the reader's identity to one silently left the other
 * behind. One mapper, one definition of what a read looks like on the wire.
 *
 * Photo resolution is best-effort: a read is never withheld because object
 * storage is unconfigured or momentarily unreachable (ADR-013).
 */
export async function toReadEventView(
  db: Database,
  storage: StoragePort,
  r: typeof readEvents.$inferSelect,
): Promise<ReadEventView> {
  const [reader] = await db
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, r.readerId))
    .limit(1);

  let photoUrl: string | null = null;
  if (r.photoKey && storage.configured) {
    try {
      photoUrl = await storage.presignDownload(r.photoKey, PHOTO_URL_TTL);
    } catch {
      photoUrl = null;
    }
  }

  return {
    id: r.id,
    value: r.value,
    consumption: r.consumption,
    readerId: r.readerId,
    readerName: reader?.name ?? null,
    capturedAt: r.capturedAt.toISOString(),
    receivedAt: r.receivedAt.toISOString(),
    sourceType: r.sourceType,
    lat: r.lat,
    lng: r.lng,
    billable: r.billable,
    annotations: (r.annotations ?? {}) as Record<string, unknown>,
    note: r.note ?? null,
    photoUrl,
  };
}

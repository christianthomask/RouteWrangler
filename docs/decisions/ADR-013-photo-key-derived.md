# ADR-013 — Photo key is derived, not mutated onto the read

Status: Accepted (Sprint 1)

## Context

Photos flow separately from reads: the event lands first, then the client
presigns and uploads, and `photo_key` "attaches async" (BUILD_SPEC §5, §7.1).
This is in apparent tension with read-event **immutability** (ADR-002): no update
path exists for a stored read.

## Decision

- The photo's S3 key is **derived deterministically from the immutable event
  id**: `photos/<readEventId>.<ext>`. The presign endpoint returns a signed PUT
  URL for that key.
- Because the key is a pure function of the event id, the read row is **never
  updated** to "attach" it — the binary simply arrives later at a known
  location. `read_events.photo_key` may be set at *creation* by the client
  (the contract allows it), but it is never mutated afterward.
- An event is never blocked by its photo: ingestion completes with or without a
  subsequent upload.

## Consequences

- Immutability holds with zero exceptions; there is no update path to review.
- A photo's presence is resolvable by convention (event id → key); a viewer can
  probe the key without a DB write.
- Presigning is real (S3 SDK), gated on `S3_BUCKET`; a labeled 503 until the
  bucket is provisioned.

# verifier — automated UAT

The pre-flight before a stakeholder session. **If it is red, do not run the
demo.**

```bash
pnpm -r build          # the UAT drives the compiled API, not tsx
pnpm uat
```

It creates a scratch database next to yours (`<yourdb>_uat`), migrates it, seeds
it, boots `apps/api/dist/main.js` against it on port 3999, drives the whole
system over HTTP, prints a pass/fail report, and drops the scratch database
again. `UAT_KEEP=true` leaves it behind to poke at; `UAT_PORT` moves the server.

## Why this exists in the repo

A UAT that is a person following notes reports whatever that person remembered
to check that day. This one reports the same things every time, and every
scenario names the decision record it exists to hold up — so a failure says
*which promise broke*, not merely that a request returned 500.

## The rules it plays by

**Everything goes through the public API.** No scenario imports a service or
opens the database. A check that reaches past HTTP is not evidence the product
works; it is evidence that some functions still compose. The simulator is used
the same way it is used in the demo — as an ordinary API client with reader
credentials and no privileged access (ADR-014).

**It keeps going after a failure.** The point of a pre-flight is to decide
whether the session can happen at all, so one run should surface everything that
is wrong rather than the first thing.

**It says what it did not prove.** Every run ends with the list. The scratch
environment has no identity provider, so the dev shim (ADR-012) stands in for
sign-in — which means this harness can never verify Google sign-in through Neon
Auth. That is verified by signing in. Object storage is only exercised when
`S3_BUCKET` is set. Nothing here says anything about the deployed environment.

Silence about a limitation reads as coverage. These are stated out loud for the
same reason `docs/STATUS.md` separates "shipped" from "shipped but unverified".

## Not part of `pnpm test`

It boots a server and takes tens of seconds. Unit runs stay hermetic and fast,
and this runs when you are about to show the product to someone.

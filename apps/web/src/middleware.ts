import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

/**
 * Clerk middleware makes auth/session available to the app and handles Clerk's
 * handshake. It runs only when a publishable key was inlined at build time
 * (deployed envs); local dev-bypass builds get a pass-through so the app runs
 * with no IdP (ADR-012, ADR-015). Route protection is not done here — the
 * NestJS API is the authorization boundary and enforces roles server-side
 * (BUILD_SPEC §6); the web only does UX-level redirects.
 */
const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default hasClerk ? clerkMiddleware() : () => NextResponse.next();

export const config = {
  matcher: [
    // Everything except Next internals and static files, unless in a search param.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API-ish routes and Clerk's handshake path.
    '/(api|trpc)(.*)',
    '/__clerk/:path*',
  ],
};

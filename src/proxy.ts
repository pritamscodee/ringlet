import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = [/^\/$/, /^\/signin$/, /^\/monitoring(\/.*)?$/, /^\/api(\/.*)?$/];

/**
 * Optimistic redirects based on the session cookie only (no database call).
 * Every page's data and every API route re-checks the real session on the server.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = !!getSessionCookie(request);
  if (pathname === "/signin" && hasSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  if (!hasSession && !PUBLIC.some((r) => r.test(pathname))) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except static files and Next internals.
  matcher: ["/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)"],
};

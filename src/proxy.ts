import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isSignIn = createRouteMatcher(["/signin"]);
const isPublic = createRouteMatcher(["/", "/signin", "/monitoring(.*)"]);

export const proxy = convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const authed = await convexAuth.isAuthenticated();
  if (isSignIn(request) && authed) return nextjsMiddlewareRedirect(request, "/dashboard");
  if (!isPublic(request) && !request.nextUrl.pathname.startsWith("/api") && !authed) {
    return nextjsMiddlewareRedirect(request, "/signin");
  }
});

export const config = {
  // Everything except static files and Next internals.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};

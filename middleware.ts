import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password && process.env.NODE_ENV === "production") {
    return new NextResponse("Set ADMIN_PASSWORD to enable the management interface", { status: 503 });
  }
  if (!password) return NextResponse.next();
  const authorization = request.headers.get("authorization") || "";
  if (authorization.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice(6));
      const separator = decoded.indexOf(":");
      if (separator > -1 && decoded.slice(0, separator) === "admin" && decoded.slice(separator + 1) === password) return NextResponse.next();
    } catch { /* Invalid Basic Auth header. */ }
  }
  return new NextResponse("Sign-in required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="InstaRSS"' } });
}

export const config = { matcher: ["/", "/api/profiles/:path*"] };

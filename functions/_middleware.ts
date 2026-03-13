function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  );
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  headers.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function withCacheHeaders(req: Request, res: Response): Response {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const headers = new Headers(res.headers);

  // Vite 产物通常带 hash，适合长缓存
  if (pathname.startsWith("/assets/")) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export const onRequest = async (context: any) => {
  const res = await context.next();
  return withSecurityHeaders(withCacheHeaders(context.request, res));
};


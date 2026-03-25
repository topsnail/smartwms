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
    "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://cloudflareinsights.com https://*.cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  headers.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function withCacheHeaders(req: Request, res: Response): Response {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const headers = new Headers(res.headers);

  // HTML/SPA 路由：不要强缓存，避免部署后仍拿到旧的 CSP/入口文件
  if (pathname === "/" || pathname.endsWith(".html")) {
    headers.set("Cache-Control", "no-store");
  }

  if (pathname.startsWith("/assets/")) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export const onRequest = async (context: any) => {
  const res = await context.next();
  return withSecurityHeaders(withCacheHeaders(context.request, res));
};


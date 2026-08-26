export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Convenience 301 redirects to the public website SPA.
  // These paths are not used by the POS/admin app, so redirecting them is safe.
  const redirects = [
    ['/cart', '/website/cart'],
    ['/checkout', '/website/checkout'],
    ['/track', '/website/track'],
  ];
  for (const [from, to] of redirects) {
    if (path === from) {
      return Response.redirect(new URL(to, url), 301);
    }
    if (path.startsWith(from + '/')) {
      return Response.redirect(new URL(to + path.slice(from.length), url), 301);
    }
  }

  // Serve real static assets directly (JS/CSS/images, sitemap.xml, robots.txt, favicons...).
  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) {
    return assetResponse;
  }

  // SPA fallback: the public website lives under /website and uses website.html.
  // Everything else (including /menu and all POS routes) serves the POS app (index.html).
  const target =
    path === '/website' || path.startsWith('/website/') ? '/website.html' : '/index.html';
  return env.ASSETS.fetch(new URL(target, url));
}

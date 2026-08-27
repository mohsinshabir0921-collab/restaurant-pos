export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  const redirects = [
    ["/cart", "/website/cart"],
    ["/checkout", "/website/checkout"],
    ["/track", "/website/track"],
  ];
  for (const [from, to] of redirects) {
    if (path === from) {
      return Response.redirect(new URL(to, url), 301);
    }
    if (path.startsWith(from + "/")) {
      return Response.redirect(new URL(to + path.slice(from.length), url), 301);
    }
  }

  const isAsset = path.startsWith("/assets/") || path.startsWith("/images/") || path.includes(".");
  if (isAsset) {
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) return assetResponse;
  }

  // Website SPA routes
  if (path === "/website" || path.startsWith("/website/")) {
    // Known static website paths that have directory index files
    const staticWebsitePaths = new Set([
      "/website",
      "/website/",
      "/website/menu",
      "/website/menu/",
      "/website/cart",
      "/website/cart/",
      "/website/checkout",
      "/website/checkout/",
      "/website/track",
      "/website/track/",
    ]);
    if (staticWebsitePaths.has(path)) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
      return env.ASSETS.fetch(new URL("/website/index.html", url));
    }
    // All other website paths are SPA deep routes -> serve website index
    return env.ASSETS.fetch(new URL("/website/index.html", url));
  }

  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) {
    return assetResponse;
  }

  return env.ASSETS.fetch(new URL("/index.html", url));
}

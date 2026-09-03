export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Static assets always pass through to the asset store
  const isAsset = path.startsWith("/assets/") || path.startsWith("/images/") || path.includes(".");
  if (isAsset) {
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) return assetResponse;
  }

  // POS deep-link fallback -> POS SPA shell. Serve the POS entry directly;
  // the built asset is at /pos/index.html (postbuild.js). Fetch that file so
  // direct /pos/* requests (e.g. /pos/settings hard refresh) never fall through
  // to the public website 404.
  if (path === "/pos" || path.startsWith("/pos/")) {
    const posResponse = await env.ASSETS.fetch(new URL("/pos/index.html", url));
    if (posResponse.status !== 404) return posResponse;
    // Fallback to pretty path for environments where directory index is required
    const posPretty = await env.ASSETS.fetch(new URL("/pos/", url));
    if (posPretty.status !== 404) return posPretty;
  }

  // Public website: static directory indices exist for /, /menu, /cart,
  // /checkout, /track and /order-confirmation. Any other public route is a
  // website SPA deep link -> serve the website shell at index.html.
  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) return assetResponse;

  return env.ASSETS.fetch(new URL("/index.html", url));
}
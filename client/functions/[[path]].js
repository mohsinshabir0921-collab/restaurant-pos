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

  // POS deep-link fallback -> POS SPA shell. env.ASSETS.fetch() must be given
  // the pretty path (/pos/) rather than the asset path (/pos/index.html);
  // see Cloudflare Pages docs on ASSETS.fetch.
  if (path === "/pos" || path.startsWith("/pos/")) {
    const posResponse = await env.ASSETS.fetch(new URL("/pos/", url));
    if (posResponse.status !== 404) return posResponse;
  }

  // Public website: static directory indices exist for /, /menu, /cart,
  // /checkout, /track and /order-confirmation. Any other public route is a
  // website SPA deep link -> serve the website shell at index.html.
  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) return assetResponse;

  return env.ASSETS.fetch(new URL("/index.html", url));
}
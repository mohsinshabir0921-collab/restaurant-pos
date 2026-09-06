import { cpSync, mkdirSync, rmSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "dist");
const websiteHtml = join(dist, "index.html");
const posHtml = join(dist, "pos.html");

if (!existsSync(websiteHtml)) {
  console.error("postbuild: dist/index.html (public website) not found — aborting");
  process.exit(1);
}

if (!existsSync(posHtml)) {
  console.error("postbuild: dist/pos.html (POS) not found — aborting");
  process.exit(1);
}

// Public website directory entry points at the root:
//   /menu, /cart, /checkout, /track, /order-confirmation, /pay
const websiteRoutes = ["", "menu", "cart", "checkout", "track", "order-confirmation", "pay"];

for (const route of websiteRoutes) {
  if (!route) continue;
  const dir = join(dist, route);
  mkdirSync(dir, { recursive: true });
  cpSync(websiteHtml, join(dir, "index.html"));
}

// POS entry point: dist/pos/index.html
const posDir = join(dist, "pos");
mkdirSync(posDir, { recursive: true });
renameSync(posHtml, join(posDir, "index.html"));

// POS deep-link directory entry points (for Cloudflare Pages manual deploy without Functions).
// Each route gets a static index.html copy of the POS shell so hard refresh of
// /pos/<route> does not fall through to the public website SPA.
const posRoutes = [
  "dashboard",
  "kitchen",
  "delivery",
  "tracking",
  "reports",
  "menu",
  "categories",
  "tables",
  "customers",
  "coupons",
  "banners",
  "staff",
  "settings",
  "inventory",
  "recipes",
  "purchase-orders",
  "waste",
  "communications",
  "loyalty",
  "orders",
];
const posIndex = join(posDir, "index.html");
for (const route of posRoutes) {
  const dir = join(posDir, route);
  mkdirSync(dir, { recursive: true });
  cpSync(posIndex, join(dir, "index.html"));
}

// Remove any stale /website output left over from previous builds
rmSync(join(dist, "website"), { recursive: true, force: true });

console.log("postbuild: created directory entry points");
console.log("  /                 -> index.html (public website)");
for (const route of websiteRoutes) {
  if (!route) continue;
  console.log(`  /${route}          -> ${route}/index.html`);
}
console.log("  /pos               -> pos/index.html (POS)");
for (const route of posRoutes) {
  console.log(`  /pos/${route}          -> pos/${route}/index.html (POS)`);
}
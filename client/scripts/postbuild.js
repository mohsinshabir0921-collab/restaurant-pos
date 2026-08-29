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
//   /menu, /cart, /checkout, /track, /order-confirmation
const websiteRoutes = ["", "menu", "cart", "checkout", "track", "order-confirmation"];

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

// Remove any stale /website output left over from previous builds
rmSync(join(dist, "website"), { recursive: true, force: true });

console.log("postbuild: created directory entry points");
console.log("  /                 -> index.html (public website)");
for (const route of websiteRoutes) {
  if (!route) continue;
  console.log(`  /${route}          -> ${route}/index.html`);
}
console.log("  /pos               -> pos/index.html (POS)");
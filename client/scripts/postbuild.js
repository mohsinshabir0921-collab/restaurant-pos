import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "dist");
const websiteHtml = join(dist, "website.html");

if (!existsSync(websiteHtml)) {
  console.error("postbuild: dist/website.html not found — aborting");
  process.exit(1);
}

const routes = ["", "menu", "cart", "checkout", "track", "order-confirmation"];

for (const route of routes) {
  const dir = route ? join(dist, "website", route) : join(dist, "website");
  mkdirSync(dir, { recursive: true });
  cpSync(websiteHtml, join(dir, "index.html"));
}

rmSync(websiteHtml);

console.log("postbuild: created website/ directory entry points");
for (const route of routes) {
  const label = "/website" + (route ? "/" + route : "");
  console.log("  " + label + " -> website/" + (route ? route + "/" : "") + "index.html");
}

// Development-only static server for the TALA JS showcase.
// Run from the package root with: bun run demo

import { resolve, extname } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const port = Number(Bun.env.PORT || 4173);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/demo/index.html";

    const relative = pathname.replace(/^\/+/, "");
    const filePath = resolve(packageRoot, relative);
    if (!filePath.startsWith(packageRoot + "/") && filePath !== packageRoot) {
      return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });

    return new Response(file, {
      headers: {
        "content-type": contentTypes.get(extname(filePath)) || "application/octet-stream",
        "cache-control": "no-store"
      }
    });
  }
});

console.log(`TALA JS showcase: http://localhost:${port}`);

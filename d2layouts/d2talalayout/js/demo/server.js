// Development-only static server for the TALA JS showcase.
// Run from the package root with: bun run demo

import { resolve, extname, sep } from "node:path";

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
    // Serve the page from /demo/ so its relative ./app.js and ./styles.css
    // resolve inside demo/, and ../src/index.js resolves to the package source.
    if (pathname === "/" || pathname === "/demo") {
      return Response.redirect(new URL("/demo/", url), 302);
    }
    if (pathname.endsWith("/")) pathname += "index.html";

    const relative = pathname.replace(/^\/+/, "");
    const filePath = resolve(packageRoot, relative);
    if (!filePath.startsWith(packageRoot + sep) && filePath !== packageRoot) {
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

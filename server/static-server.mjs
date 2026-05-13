import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const indexPath = path.join(distRoot, "index.html");

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const hosts = (process.env.HOSTS ?? process.env.HOST ?? "127.0.0.1")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const mimeTypes = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
]);

await access(indexPath).catch(() => {
  console.error("Missing dist/index.html. Run `npm run build` before starting.");
  process.exit(1);
});

function getCacheControl(filePath) {
  const relative = path.relative(distRoot, filePath).replaceAll(path.sep, "/");
  return relative.startsWith("assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl ?? "/", "http://localhost");
  const decodedPath = decodeURIComponent(url.pathname);
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.normalize(path.join(distRoot, requestedPath));
  const relativePath = path.relative(distRoot, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return filePath;
}

async function findFilePath(request) {
  const filePath = resolveRequestPath(request.url);

  if (!filePath) {
    return { status: 403 };
  }

  try {
    const stats = await stat(filePath);
    if (stats.isFile()) {
      return { filePath };
    }
  } catch {
    // Fall through to SPA fallback below.
  }

  const accept = request.headers.accept ?? "";
  if (accept.includes("text/html") || accept.includes("*/*")) {
    return { filePath: indexPath };
  }

  return { status: 404 };
}

async function handleRequest(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }

  const result = await findFilePath(request);
  if (!result.filePath) {
    response.writeHead(result.status);
    response.end(result.status === 403 ? "Forbidden" : "Not Found");
    return;
  }

  const contentType =
    mimeTypes.get(path.extname(result.filePath).toLowerCase()) ??
    "application/octet-stream";

  response.writeHead(200, {
    "Cache-Control": getCacheControl(result.filePath),
    "Content-Type": contentType,
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(result.filePath).pipe(response);
}

async function listen(host) {
  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error(error);
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end("Internal Server Error");
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

const servers = [];
try {
  for (const host of hosts) {
    servers.push(await listen(host));
    console.log(`Zeus Minigame serving dist on http://${host}:${port}`);
  }
} catch (error) {
  for (const server of servers) {
    server.close();
  }
  console.error(error);
  process.exit(1);
}

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const url = process.env.TERRAIN_LAB_VERIFY_URL ?? "http://127.0.0.1:5176/";
const port = new URL(url).port || "5176";
const browserPath = await resolveBrowserPath();
let devServer = null;

try {
  if (!(await isReachable(url))) devServer = await startDevServer();
  await verifyWorkbench();
  console.log("terrain workbench desktop: passed");
} finally {
  if (devServer) devServer.kill();
}

async function verifyWorkbench() {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector(".catalog-view");
    if (await page.locator(".catalog-entry").count() < 40) throw new Error("catalog did not expose the complete authored definition inventory");

    await page.getByLabel("Search patch catalog").fill("cliff-river");
    if (await page.locator(".catalog-entry").count() !== 1) throw new Error("catalog search did not isolate the cliff-river transition");
    await page.locator(".catalog-entry").click();
    if (await page.locator(".catalog-inspector h2").textContent() !== "patch.transition.cliff-river") throw new Error("filtered transition did not open in the patch inspector");
    if (await page.locator(".comparison-patch .patch-svg").count() !== 2) throw new Error("authored/procedural comparison did not render both realizations");
    if (!(await page.locator(".details-stack").textContent()).includes("river-1")) throw new Error("derived river component was not displayed");

    await page.getByRole("button", { name: "World Explorer" }).click();
    await page.getByLabel("Patch radius").fill("3");
    await page.getByLabel("Patch radius").press("Enter");
    await page.getByRole("button", { name: "Advance one patch" }).click();
    await page.waitForFunction(() => document.querySelector(".world-status")?.textContent?.startsWith("1 patches"));
    await page.getByRole("button", { name: "Generate all" }).click();
    await page.waitForFunction(() => document.querySelector(".world-status")?.textContent?.includes("complete"), null, { timeout: 30_000 });
    const status = await page.locator(".world-status").textContent();
    if (!status.includes("37 patches") || !status.includes("authored") || !status.includes("procedural")) throw new Error(`world explorer status was incomplete: ${status}`);
    const canvas = page.locator("canvas.world-canvas");
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("world canvas had no rendered bounds");
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.waitForSelector(".selected-patch-header");
    if (await page.locator(".world-details .patch-svg").count() !== 1) throw new Error("selected committed patch did not render its exact interior");
    await page.getByRole("button", { name: "Open in catalog" }).click();
    if (await page.locator(".catalog-view").count() !== 1) throw new Error("generated authored patch did not link back to the catalog");
    if (errors.length) throw new Error(`browser errors: ${errors.join(" | ")}`);
    await page.close();
  } finally {
    await browser.close();
  }
}

async function startDevServer() {
  const viteCli = path.join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
  const server = spawn(process.execPath, [viteCli, "--config", "vite.terrain-lab.config.ts", "--host", "127.0.0.1", "--port", port, "--strictPort", "--force"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  const logs = [];
  server.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  server.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Terrain lab Vite exited early:\n${logs.join("")}`);
    if (await isReachable(url)) return server;
    await delay(250);
  }
  server.kill();
  throw new Error(`Timed out waiting for ${url}:\n${logs.join("")}`);
}

async function isReachable(target) { try { return (await fetch(target)).ok; } catch { return false; } }

async function resolveBrowserPath() {
  const explicit = process.env.PLAYWRIGHT_BROWSER_PATH;
  if (explicit && await exists(explicit)) return explicit;
  const candidates = process.platform === "win32"
    ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error("No Chrome/Edge executable found. Set PLAYWRIGHT_BROWSER_PATH.");
}

async function exists(filePath) { try { await fs.access(filePath); return true; } catch { return false; } }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

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
  console.log("terrain workbench: all viewports passed");
} finally {
  if (devServer) devServer.kill();
}

async function verifyWorkbench() {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const viewport of [{ name: "desktop", width: 1280, height: 720 }, { name: "uwqhd", width: 3440, height: 1440 }]) {
      await verifyViewport(browser, viewport);
      console.log(`terrain workbench ${viewport.name}: passed`);
    }
  } finally {
    await browser.close();
  }
}

async function verifyViewport(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".catalog-view");
  if (await page.locator(".catalog-entry").count() < 40) throw new Error(`${viewport.name} catalog did not expose the complete inventory`);
  const catalogIds = await page.locator(".catalog-entry strong").allTextContents();
  if (catalogIds.some((id) => id === "patch.open.dirt" || id === "patch.open.basin")) throw new Error(`${viewport.name} catalog retained a dirt definition`);
  await assertViewportContained(page, viewport, "catalog");

  await page.getByLabel("Search patch catalog").fill("cliff-river");
  if (await page.locator(".catalog-entry").count() !== 1) throw new Error(`${viewport.name} catalog search did not isolate cliff-river`);
  await page.locator(".catalog-entry").click();
  if (await page.locator(".catalog-inspector h2").textContent() !== "patch.transition.cliff-river") throw new Error(`${viewport.name} filtered transition did not open`);
  const comparison = page.locator("details.comparison");
  if (await comparison.getAttribute("open") !== null || await page.locator(".comparison-patch").count() !== 0) throw new Error(`${viewport.name} fallback preview was not initially collapsed`);
  const comparisonCopy = await comparison.textContent();
  if (!comparisonCopy.includes("Boundary-only fallback preview") || !comparisonCopy.includes("not a prediction")) throw new Error(`${viewport.name} fallback preview lacked its scope explanation`);
  await page.locator(".comparison-toggle").click();
  await page.waitForSelector(".comparison-patch .patch-svg");
  if (await page.locator(".comparison-patch .patch-svg").count() !== 2) throw new Error(`${viewport.name} fallback preview did not render both interiors`);
  const comparisonSpacing = await page.evaluate(() => [...document.querySelectorAll(".comparison-patch")].map((card) => ({
    headingBottom: card.querySelector("h4")?.getBoundingClientRect().bottom ?? 0,
    patchTop: card.querySelector(".patch-svg")?.getBoundingClientRect().top ?? 0,
  })));
  if (comparisonSpacing.some(({ headingBottom, patchTop }) => patchTop < headingBottom + 6)) {
    throw new Error(`${viewport.name} comparison patch overlapped its title: ${JSON.stringify(comparisonSpacing)}`);
  }
  if (!(await page.locator(".details-stack").textContent()).includes("river-1")) throw new Error(`${viewport.name} derived river component was not displayed`);

  await page.getByRole("button", { name: "World Explorer" }).click();
  await page.getByLabel("Patch radius").fill("3");
  await page.getByLabel("Patch radius").press("Enter");
  await page.getByRole("button", { name: "Advance one patch" }).click();
  await page.waitForFunction(() => document.querySelector(".world-status")?.textContent?.startsWith("1 / 37 patches"));
  await page.getByRole("button", { name: "Generate all" }).click();
  await page.waitForFunction(() => document.querySelector(".world-status")?.textContent?.includes("complete"), null, { timeout: 30_000 });
  const status = await page.locator(".world-status").textContent();
  if (!status.includes("37 / 37 patches") || !status.includes("authored") || !status.includes("procedural")) throw new Error(`${viewport.name} world status was incomplete: ${status}`);
  await assertViewportContained(page, viewport, "world");
  await page.getByRole("button", { name: "Zoom in" }).click();
  if (await page.locator(".zoom-output").textContent() !== "125%") throw new Error(`${viewport.name} zoom-in control did not update the camera`);
  await page.getByRole("button", { name: "Fit world" }).click();
  if (await page.locator(".zoom-output").textContent() !== "100%") throw new Error(`${viewport.name} fit control did not reset the camera`);
  const canvas = page.locator("canvas.world-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error(`${viewport.name} world canvas had no rendered bounds`);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.waitForSelector(".selected-patch-header");
  if (await page.locator(".world-details .patch-svg").count() !== 1) throw new Error(`${viewport.name} selected patch did not render its interior`);
  await page.getByRole("button", { name: "Open in catalog" }).click();
  if (await page.locator(".catalog-view").count() !== 1) throw new Error(`${viewport.name} generated patch did not link to the catalog`);
  if (errors.length) throw new Error(`${viewport.name} browser errors: ${errors.join(" | ")}`);
  await page.close();
}

async function assertViewportContained(page, viewport, label) {
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.world-canvas");
    const canvasBounds = canvas?.getBoundingClientRect();
    return {
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      canvasBottom: canvasBounds?.bottom ?? 0,
    };
  });
  if (layout.documentHeight > layout.viewportHeight || layout.canvasBottom > viewport.height + 1) {
    throw new Error(`${viewport.name} ${label} escaped the viewport: ${JSON.stringify(layout)}`);
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

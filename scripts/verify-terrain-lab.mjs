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
  const comparisonBounds = await page.evaluate(() => [...document.querySelectorAll(".comparison-patch")].map((card) => {
    const bounds = (selector) => {
      const rect = card.querySelector(selector)?.getBoundingClientRect();
      return rect ? { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left } : null;
    };
    const cardRect = card.getBoundingClientRect();
    const frame = card.querySelector(".comparison-preview-frame");
    const preview = card.querySelector(".patch-svg");
    const previewRect = preview?.getBoundingClientRect();
    const contentsContained = previewRect ? [...preview.querySelectorAll("polygon")].every((polygon) => {
      const rect = polygon.getBoundingClientRect();
      return rect.top >= previewRect.top - 1 && rect.right <= previewRect.right + 1
        && rect.bottom <= previewRect.bottom + 1 && rect.left >= previewRect.left - 1;
    }) : false;
    return {
      card: { top: cardRect.top, right: cardRect.right, bottom: cardRect.bottom, left: cardRect.left },
      header: bounds(".comparison-patch-header"),
      frame: bounds(".comparison-preview-frame"),
      preview: bounds(".patch-svg"),
      frameOverflow: frame ? getComputedStyle(frame).overflow : null,
      contentsContained,
    };
  }));
  const comparisonEscaped = comparisonBounds.some(({ card, header, frame, preview, frameOverflow, contentsContained }) => {
    if (!card || !header || !frame || !preview || frameOverflow !== "hidden" || !contentsContained) return true;
    const inside = (inner, outer) => inner.top >= outer.top - 1 && inner.right <= outer.right + 1
      && inner.bottom <= outer.bottom + 1 && inner.left >= outer.left - 1;
    return frame.top < header.bottom + 8 || !inside(frame, card) || !inside(preview, frame);
  });
  if (comparisonEscaped) {
    throw new Error(`${viewport.name} comparison preview escaped its dedicated frame: ${JSON.stringify(comparisonBounds)}`);
  }
  if (!(await page.locator(".details-stack").textContent()).includes("river-1")) throw new Error(`${viewport.name} derived river component was not displayed`);

  await page.getByRole("button", { name: "Connection Lab" }).click();
  for (const direction of ["NE", "E", "SE", "SW", "W", "NW"]) {
    await page.getByLabel(`${direction} neighbor`, { exact: true }).selectOption("patch.open.grass");
  }
  await page.getByLabel("Scenario name").fill(`Verified ${viewport.name} ring`);
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await page.waitForSelector(".resolution-summary");
  const resolutionCopy = await page.locator(".resolution-summary").textContent();
  if (!resolutionCopy.includes("authored candidates") || !resolutionCopy.includes("procedural layouts") || !resolutionCopy.includes("topology groups")) {
    throw new Error(`${viewport.name} connection resolution summary was incomplete: ${resolutionCopy}`);
  }
  if (await page.locator(".candidate-card").count() < 2) throw new Error(`${viewport.name} connection lab did not render candidate comparisons`);
  const escapedCandidate = await page.evaluate(() => [...document.querySelectorAll(".candidate-preview")].some((frame) => {
    const frameRect = frame.getBoundingClientRect();
    const svgRect = frame.querySelector("svg")?.getBoundingClientRect();
    return !svgRect || svgRect.top < frameRect.top - 1 || svgRect.right > frameRect.right + 1
      || svgRect.bottom > frameRect.bottom + 1 || svgRect.left < frameRect.left - 1;
  }));
  if (escapedCandidate) throw new Error(`${viewport.name} connection candidate escaped its preview frame`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Save decision" }).click();
  await assertViewportContained(page, viewport, "connection");

  await page.getByRole("button", { name: "Decisions & Coverage" }).click();
  await page.getByRole("button", { name: "Generate coverage" }).click();
  await page.waitForSelector(".coverage-table tbody tr");
  if (await page.locator(".coverage-table tbody tr").count() < 20) throw new Error(`${viewport.name} coverage matrix was unexpectedly empty`);
  if (!(await page.locator(".coverage-summary").textContent()).includes("classified")) throw new Error(`${viewport.name} coverage summary omitted decisions`);
  await page.getByRole("button", { name: "Open in lab" }).first().click();
  const placedWitnessNeighbors = await page.locator(".neighbor-slot select").evaluateAll((selects) => selects.filter((select) => select.value).length);
  if (placedWitnessNeighbors !== 6) throw new Error(`${viewport.name} coverage witness did not restore a full neighbor ring`);
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await page.waitForSelector(".recipe-controls");
  await page.getByLabel("Recipe action").selectOption("terminate");
  await page.getByRole("button", { name: "Run experiment" }).click();
  await page.waitForSelector(".recipe-results");
  const recipeCopy = await page.locator(".recipe-results").textContent();
  if (!recipeCopy.includes("Experimental recipe result")) throw new Error(`${viewport.name} recipe experiment did not report a comparison`);
  await page.getByRole("button", { name: "Save recipe" }).click();
  await page.getByRole("button", { name: "Run saved scenarios" }).click();
  if (!(await page.locator(".recipe-batch-result").textContent()).includes("saved scenarios checked")) throw new Error(`${viewport.name} recipe batch did not run saved scenarios`);

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
  await page.getByRole("button", { name: "Network Analysis" }).click();
  await page.getByRole("button", { name: "Scan current region" }).click();
  await page.waitForSelector(".network-summary");
  if (await page.locator(".network-stat").count() !== 6) throw new Error(`${viewport.name} network summary was incomplete`);
  if (await page.locator(".network-rollup").count() !== 1 || await page.locator(".network-issues").count() !== 1) throw new Error(`${viewport.name} network analysis omitted its rollup or issue queue`);
  await page.getByLabel("Network issue severity").selectOption("all");
  if (await page.locator(".network-issue").count() > 0) {
    await page.getByRole("button", { name: "Focus in World Explorer" }).first().click();
    if (await page.locator(".world-view").count() !== 1) throw new Error(`${viewport.name} network issue did not focus World Explorer`);
  } else {
    await page.getByRole("button", { name: "World Explorer" }).click();
  }
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
  await page.getByRole("button", { name: "World Explorer" }).click();
  await page.getByRole("button", { name: "Open surrounding connection" }).click();
  if (await page.locator(".connection-view").count() !== 1) throw new Error(`${viewport.name} generated patch did not open in the Connection Lab`);
  const worldNeighborCount = await page.locator(".neighbor-slot select").evaluateAll((selects) => selects.filter((select) => select.value).length);
  if (worldNeighborCount === 0) throw new Error(`${viewport.name} World Explorer handoff did not include committed neighbors`);
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

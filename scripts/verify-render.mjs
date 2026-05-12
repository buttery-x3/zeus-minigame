import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const url = process.env.VERIFY_URL ?? "http://127.0.0.1:5173/";
const parsedUrl = new URL(url);
const port = process.env.VERIFY_PORT ?? (parsedUrl.port || "5173");
const outputDir = path.resolve(process.env.VERIFY_OUTPUT_DIR ?? "verify");
const browserPath = await resolveBrowserPath();
const viewports = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "mobile", width: 390, height: 844 },
];

let devServer = null;

try {
  await fs.mkdir(outputDir, { recursive: true });

  if (!(await isReachable(url))) {
    devServer = await startDevServer();
  }

  const results = await verifyInBrowser();
  for (const result of results) {
    console.log(
      `${result.viewport.name}: ${result.metrics.canvasWidth}x${result.metrics.canvasHeight}, nonDark=${result.metrics.nonDark}, bright=${result.metrics.bright}, buckets=${result.metrics.colorBuckets}`,
    );
    console.log(`  screenshot: ${result.screenshotPath}`);
  }
} finally {
  if (devServer) {
    devServer.kill();
  }
}

async function verifyInBrowser() {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const results = [];

  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      const errors = [];

      page.on("console", (message) => {
        if (message.type() === "error") {
          errors.push(message.text());
        }
      });
      page.on("pageerror", (error) => errors.push(error.message));

      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForSelector("canvas");
      await page.waitForSelector(".hud__stats");

      await exerciseCoreInteractions(page, viewport);

      const screenshotPath = path.join(outputDir, `${viewport.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const metrics = await collectCanvasMetrics(page);
      const hud = await collectHudMetrics(page);
      const result = { viewport, screenshotPath, metrics, hud, errors };
      assertResult(result);
      results.push(result);

      await page.close();
    }
  } finally {
    await browser.close();
  }

  return results;
}

async function exerciseCoreInteractions(page, viewport) {
  await page.mouse.move(viewport.width * 0.62, viewport.height * 0.58);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.mouse.up();

  await page.keyboard.press("KeyQ");
  await page.mouse.click(viewport.width * 0.55, viewport.height * 0.48);
  await page.keyboard.press("KeyW");
  await page.mouse.click(viewport.width * 0.45, viewport.height * 0.55);
  await page.waitForTimeout(700);
}

async function collectCanvasMetrics(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      throw new Error("Missing canvas");
    }

    const sample = document.createElement("canvas");
    sample.width = 180;
    sample.height = 120;
    const context = sample.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Missing sampler context");
    }

    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let nonDark = 0;
    let bright = 0;
    const buckets = new Set();

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      if (a > 0 && luminance > 22) {
        nonDark += 1;
      }
      if (a > 0 && luminance > 95) {
        bright += 1;
      }
      buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }

    return {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      nonDark,
      bright,
      colorBuckets: buckets.size,
    };
  });
}

async function collectHudMetrics(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const abilities = [...document.querySelectorAll(".ability")].map((element) => element.textContent?.trim() ?? "");
    const statusVisible = getComputedStyle(document.querySelector(".hud") ?? document.body).display !== "none";
    return {
      hasKills: text.includes("Kills"),
      hasWave: text.includes("Wave"),
      hasCell: text.includes("Cell"),
      hasChain: abilities.some((text) => text.includes("Q") && text.includes("Chain")),
      hasBolt: abilities.some((text) => text.includes("W") && text.includes("Bolt")),
      statusVisible,
    };
  });
}

function assertResult(result) {
  const { viewport, metrics, hud, errors } = result;
  const usablePixels = metrics.nonDark > 1500 && metrics.bright > 20 && metrics.colorBuckets > 18;
  const hudOk = hud.hasKills && hud.hasWave && hud.hasCell && hud.hasChain && hud.hasBolt && hud.statusVisible;

  if (!usablePixels) {
    throw new Error(`${viewport.name} canvas looked blank or too flat: ${JSON.stringify(metrics)}`);
  }
  if (!hudOk) {
    throw new Error(`${viewport.name} HUD check failed: ${JSON.stringify(hud)}`);
  }
  if (errors.length > 0) {
    throw new Error(`${viewport.name} browser errors: ${errors.join(" | ")}`);
  }
}

async function startDevServer() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const server = spawn(npmCommand, ["run", "dev", "--", "--port", port, "--strictPort", "--force"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs = [];
  server.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  server.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited before becoming reachable:\n${logs.join("")}`);
    }
    if (await isReachable(url)) {
      return server;
    }
    await delay(250);
  }

  server.kill();
  throw new Error(`Timed out waiting for ${url}:\n${logs.join("")}`);
}

async function isReachable(targetUrl) {
  try {
    const response = await fetch(targetUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveBrowserPath() {
  const explicit = process.env.PLAYWRIGHT_BROWSER_PATH;
  if (explicit && (await exists(explicit))) {
    return explicit;
  }

  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  throw new Error("No Chrome/Edge executable found. Set PLAYWRIGHT_BROWSER_PATH to a Chromium-based browser.");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

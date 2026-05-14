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
      await page.waitForSelector(".ui-layer");
      await page.waitForSelector(".hud__stats");
      await page.waitForSelector(".ui-toolbar");

      await verifyCameraRigStability(page, viewport);
      await verifyShadowRigTracking(page, viewport);
      await verifyBlockerNavigation(page, viewport);
      await verifyEnemyHealthBars(page, viewport);
      await verifyWindowUi(page, viewport);
      await exerciseCoreInteractions(page, viewport);
      await verifyEnemyPathfindingBudget(page, viewport, "after core interactions");

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

async function verifyShadowRigTracking(page, viewport) {
  const start = await readDiagnostics(page);
  if (!start.lighting) {
    throw new Error(`${viewport.name} missing lighting diagnostics`);
  }

  await page.mouse.click(viewport.width * 0.82, viewport.height * 0.62);
  await page.waitForTimeout(1200);
  const after = await readDiagnostics(page);

  const playerMove = groundDistance(after.player.position, start.player.position);
  const shadowMove = groundDistance(after.lighting.focus, start.lighting.focus);
  const focusDistance = groundDistance(after.lighting.focus, after.player.position);

  if (playerMove < 8) {
    throw new Error(`${viewport.name} shadow rig check did not move the player far enough: ${playerMove}`);
  }
  if (shadowMove < 8) {
    throw new Error(`${viewport.name} shadow rig did not follow gameplay focus: ${shadowMove}`);
  }
  if (focusDistance > after.lighting.texelSize * 3) {
    throw new Error(`${viewport.name} shadow focus is not snapped near player: ${focusDistance}`);
  }
}

async function verifyWindowUi(page, viewport) {
  await page.click('[data-ui-action="pause"]');
  await page.waitForSelector('[data-window-id="pause-menu"]:not([hidden])');

  let diagnostics = await readDiagnostics(page);
  if (!diagnostics.paused) {
    throw new Error("Pause toolbar button did not pause the game");
  }

  await verifyEnemyHealthBarOptions(page);

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector('[data-window-id="pause-menu"]')?.hasAttribute("hidden"));
  diagnostics = await readDiagnostics(page);
  if (diagnostics.paused) {
    throw new Error("Escape did not resume from pause menu");
  }

  await page.keyboard.press("Backquote");
  await page.waitForSelector('[data-window-id="diagnostics"]:not([hidden])');
  await page.waitForFunction(() => document.querySelector('[data-window-id="diagnostics"]')?.textContent?.includes("Flow"));

  diagnostics = await readDiagnostics(page);
  if (!diagnostics.profiler.enemyNavigation || diagnostics.profiler.enemyNavigation.flowRadius <= 0) {
    throw new Error("Diagnostics did not expose enemy flow-field metrics");
  }
  verifyEnemyPathfindingBudgetSnapshot(diagnostics, viewport, "diagnostics window");

  await page.click('[data-window-id="diagnostics"] .game-window__action--lock');
  const locked = await page.$eval('[data-window-id="diagnostics"]', (element) => element.classList.contains("game-window--locked"));
  if (!locked) {
    throw new Error("Diagnostics lock button did not lock the window");
  }

  await page.click('[data-window-id="diagnostics"] .game-window__action--close');
  await page.waitForFunction(() => document.querySelector('[data-window-id="diagnostics"]')?.hasAttribute("hidden"));
}

async function verifyEnemyPathfindingBudget(page, viewport, phase) {
  await page.waitForTimeout(300);
  verifyEnemyPathfindingBudgetSnapshot(await readDiagnostics(page), viewport, phase);
}

function verifyEnemyPathfindingBudgetSnapshot(diagnostics, viewport, phase) {
  const calls = diagnostics.profiler.pathfinding.calls;
  if (calls > 20) {
    throw new Error(`${viewport.name} pathfinding spike ${phase}: ${calls} calls`);
  }
}

async function verifyEnemyHealthBarOptions(page) {
  for (const mode of ["hidden", "always", "smart"]) {
    await page.click(`[data-health-mode="${mode}"]`);
    const diagnostics = await readDiagnostics(page);
    if (diagnostics.enemyHealthBars.mode !== mode) {
      throw new Error(`Enemy health bar mode button did not select ${mode}`);
    }
  }
}

async function verifyCameraRigStability(page, viewport) {
  const start = await readDiagnostics(page);

  await page.mouse.click(viewport.width * 0.68, viewport.height * 0.56);
  await page.waitForTimeout(260);
  const firstMove = await readDiagnostics(page);

  await page.mouse.click(viewport.width * 0.32, viewport.height * 0.48);
  await page.waitForTimeout(260);
  const secondMove = await readDiagnostics(page);

  const cameraDrift = Math.max(
    quaternionDistance(start.camera.quaternion, firstMove.camera.quaternion),
    quaternionDistance(start.camera.quaternion, secondMove.camera.quaternion),
    quaternionDistance(firstMove.camera.quaternion, secondMove.camera.quaternion),
  );

  const playerTurned = Math.abs(firstMove.player.rotationY - secondMove.player.rotationY) > 0.4;
  if (!playerTurned) {
    throw new Error(`${viewport.name} camera check did not exercise opposing movement directions`);
  }
  if (cameraDrift > 0.001) {
    throw new Error(`${viewport.name} camera orientation drifted while following player: ${cameraDrift}`);
  }
}

async function verifyBlockerNavigation(page, viewport) {
  const before = await readDiagnostics(page);
  const blocker = before.nearestBlockedCell;
  if (!blocker) {
    throw new Error(`${viewport.name} blocker navigation check could not find a visible blocker`);
  }

  if (blocker.screen.x < 0 || blocker.screen.x > viewport.width || blocker.screen.y < 0 || blocker.screen.y > viewport.height) {
    throw new Error(`${viewport.name} visible blocker projected outside viewport: ${JSON.stringify(blocker.screen)}`);
  }

  await page.mouse.click(blocker.screen.x, blocker.screen.y);
  await page.waitForTimeout(450);

  const after = await readDiagnostics(page);
  const navigation = after.player.navigation;
  if (!navigation.requestedBlocked) {
    throw new Error(`${viewport.name} blocker click did not register as a blocked request`);
  }
  if (navigation.destinationBlocked || navigation.occupiesBlocked) {
    throw new Error(`${viewport.name} blocker navigation resolved into blocked space: ${JSON.stringify(navigation)}`);
  }

  const moveTarget = navigation.moveTarget;
  if (groundDistance(moveTarget, blocker.world) < 0.25) {
    throw new Error(`${viewport.name} blocker navigation did not move target away from blocked cell`);
  }
  if (groundDistance(moveTarget, blocker.world) > 10) {
    throw new Error(`${viewport.name} blocker navigation target was not near clicked blocker edge`);
  }
}

async function verifyEnemyHealthBars(page, viewport) {
  const before = await readDiagnostics(page);
  if (!before.enemyHealthBars) {
    throw new Error(`${viewport.name} missing enemy health bar diagnostics`);
  }
  if (before.enemyHealthBars.mode !== "smart") {
    throw new Error(`${viewport.name} expected smart enemy health bar mode by default`);
  }
  if (before.enemyHealthBars.total < 1) {
    throw new Error(`${viewport.name} expected spawned enemy health bars`);
  }

  await page.keyboard.down("Alt");
  try {
    await page.waitForFunction(() => {
      const bars = window.__ZEUS_GAME__?.getDiagnostics().enemyHealthBars;
      return bars?.revealAll && bars.total > 0 && bars.visible === bars.total;
    });
  } finally {
    await page.keyboard.up("Alt");
  }

  await page.waitForFunction(() => !window.__ZEUS_GAME__?.getDiagnostics().enemyHealthBars.revealAll);
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

async function readDiagnostics(page) {
  return page.evaluate(() => {
    const game = window.__ZEUS_GAME__;
    if (!game) {
      throw new Error("Missing Zeus game diagnostics hook");
    }

    return game.getDiagnostics();
  });
}

function quaternionDistance(a, b) {
  const dot = Math.abs(a.reduce((sum, value, index) => sum + value * b[index], 0));
  return 1 - Math.min(1, dot);
}

function groundDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
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
    const statusVisible = getComputedStyle(document.querySelector(".ui-layer") ?? document.body).display !== "none";
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

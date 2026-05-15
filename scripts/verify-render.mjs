import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const url = process.env.VERIFY_URL ?? "http://127.0.0.1:5173/";
const parsedUrl = new URL(url);
const port = process.env.VERIFY_PORT ?? (parsedUrl.port || "5173");
const outputDir = path.resolve(process.env.VERIFY_OUTPUT_DIR ?? "verify");
const browserPath = await resolveBrowserPath();
const spellManaCosts = {
  chain: 22,
  bolt: 34,
};
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

      await verifyHudTransparency(page, viewport);
      await verifyHeldClickTracksCamera(page, viewport);
      await verifyCameraRigStability(page, viewport);
      await verifyShadowRigTracking(page, viewport);
      await verifyVisibilitySystem(page, viewport);
      await verifyBlockerNavigation(page, viewport);
      await verifyEnemyHealthBars(page, viewport);
      await verifyEnemyAvoidance(page, viewport);
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

  await clickVisibleMoveCell(page, viewport, 0.82, 0.62);
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

async function verifyVisibilitySystem(page, viewport) {
  const start = await readDiagnostics(page);
  if (!start.visibility) {
    throw new Error(`${viewport.name} missing visibility diagnostics`);
  }
  if (!start.visibilityOverlay || start.visibilityOverlay.resolutionScale !== 2) {
    throw new Error(`${viewport.name} visibility overlay did not report 2x resolution: ${JSON.stringify(start.visibilityOverlay)}`);
  }
  if (start.visibility.visibleCells < 80) {
    throw new Error(`${viewport.name} visibility revealed too few cells: ${JSON.stringify(start.visibility)}`);
  }
  if (start.visibility.discoveredCells < start.visibility.visibleCells) {
    throw new Error(`${viewport.name} discovered cells should include current visible cells: ${JSON.stringify(start.visibility)}`);
  }
  if (start.visibility.lightReachCells < start.visibility.visibleCells) {
    throw new Error(`${viewport.name} light reach should include current visible cells: ${JSON.stringify(start.visibility)}`);
  }
  if (start.visibility.outerRadiusCells <= start.visibility.innerRadiusCells) {
    throw new Error(`${viewport.name} invalid visibility radii: ${JSON.stringify(start.visibility)}`);
  }
  if (!start.visibility.shadowSample) {
    throw new Error(`${viewport.name} expected blocker visibility to create a shadow sample`);
  }

  await verifyHiddenCastRejected(page, viewport, start);
  await verifyOutOfRangeCastSnaps(page, viewport);
  await verifyUndiscoveredMoveRejected(page, viewport, start);

  const beforeMove = await readDiagnostics(page);
  let afterMove = beforeMove;
  for (let step = 0; step < 5; step += 1) {
    await clickVisibleMoveCell(page, viewport, 0.74, 0.62);
    await page.waitForTimeout(850);
    afterMove = await readDiagnostics(page);
    if (afterMove.visibilitySamples.discoveredUnlitCell) {
      break;
    }
  }

  if (
    afterMove.visibility.discoveredCells <= beforeMove.visibility.discoveredCells &&
    !afterMove.visibilitySamples.discoveredUnlitCell
  ) {
    throw new Error(
      `${viewport.name} discovered cell count did not grow after exploration: before=${beforeMove.visibility.discoveredCells}, after=${afterMove.visibility.discoveredCells}`,
    );
  }
  if (!afterMove.visibilitySamples.discoveredUnlitCell || afterMove.visibility.discoveredUnlitCells < 1) {
    throw new Error(`${viewport.name} expected movement to leave discovered terrain outside current light`);
  }

  const blockers = afterMove.terrain?.blockers;
  if (!blockers || blockers.total < 1 || blockers.visible + blockers.hidden !== blockers.total) {
    throw new Error(`${viewport.name} invalid blocker visibility diagnostics: ${JSON.stringify(blockers)}`);
  }
  if (blockers.hidden < 1) {
    throw new Error(`${viewport.name} expected at least one active blocker to be hidden in darkness: ${JSON.stringify(blockers)}`);
  }

  const unlit = afterMove.visibilitySamples.discoveredUnlitCell.visibility;
  if (!unlit.discovered || unlit.visible || unlit.lightReach > 0.001) {
    throw new Error(`${viewport.name} discovered-unlit sample had wrong visibility state: ${JSON.stringify(unlit)}`);
  }

  const blockedMemory = afterMove.visibilitySamples.blockedMemoryCell;
  if (afterMove.visibility.occludedMemoryCells > 0 && !blockedMemory) {
    throw new Error(`${viewport.name} visibility diagnostics counted blocked memory without exposing a sample`);
  }
  if (blockedMemory) {
    const memory = blockedMemory.visibility;
    if (!memory.discovered || memory.visible || memory.lightReach <= 0.001) {
      throw new Error(`${viewport.name} blocked-memory sample had wrong visibility state: ${JSON.stringify(memory)}`);
    }
  }
}

async function verifyHiddenCastRejected(page, viewport, diagnostics) {
  diagnostics = await readDiagnostics(page);
  const shadowed = diagnostics.visibilitySamples.shadowedCell;
  if (!shadowed?.screen?.visible || groundDistance(diagnostics.player.position, shadowed.world) > 43.5) {
    return;
  }

  await waitForSpellReady(page, "chain");
  const before = await readDiagnostics(page);
  await page.mouse.move(shadowed.screen.x, shadowed.screen.y);
  await releaseSpellKeys(page);
  await page.keyboard.down("KeyQ");
  await waitForCastMode(page, "chain");
  await page.keyboard.up("KeyQ");
  await waitForNoCastMode(page);
  await page.waitForTimeout(120);

  const after = await readDiagnostics(page);
  if (after.spells.cooldowns.chain > before.spells.cooldowns.chain + 0.05) {
    throw new Error(`${viewport.name} cast into hidden blocker shadow was not rejected`);
  }
}

async function verifyUndiscoveredMoveRejected(page, viewport, diagnostics) {
  diagnostics = await readDiagnostics(page);
  const undiscovered = diagnostics.visibilitySamples.farUndiscoveredCell ?? diagnostics.visibilitySamples.nearestUndiscoveredCell;
  if (!undiscovered?.screen?.visible) {
    return;
  }

  const before = await readDiagnostics(page);
  await page.mouse.click(undiscovered.screen.x, undiscovered.screen.y);
  await page.waitForTimeout(180);
  const after = await readDiagnostics(page);

  if (groundDistance(after.player.navigation.moveTarget, before.player.navigation.moveTarget) > 0.25) {
    throw new Error(`${viewport.name} undiscovered terrain accepted a movement command`);
  }

  const beforeHold = await readDiagnostics(page);
  await page.mouse.move(undiscovered.screen.x, undiscovered.screen.y);
  await page.mouse.down();
  await page.waitForTimeout(320);
  await page.mouse.up();
  await page.waitForTimeout(120);
  const afterHold = await readDiagnostics(page);

  if (groundDistance(afterHold.player.navigation.moveTarget, beforeHold.player.navigation.moveTarget) > 0.25) {
    throw new Error(`${viewport.name} undiscovered terrain accepted a held movement command`);
  }
}

async function verifyOutOfRangeCastSnaps(page, viewport) {
  if (!(await aimAtOutOfRangeChainTarget(page))) {
    return;
  }

  await waitForSpellReady(page, "chain");
  await releaseSpellKeys(page);
  await page.keyboard.down("KeyQ");
  await waitForCastMode(page, "chain");
  await page.keyboard.up("KeyQ");
  await waitForSpellCooldown(page, "chain");
}

async function verifyOutOfRangeCastRejected(page, viewport) {
  if (!(await aimAtOutOfRangeChainTarget(page))) {
    return;
  }

  await waitForSpellReady(page, "chain");
  const before = await readDiagnostics(page);
  await releaseSpellKeys(page);
  await page.keyboard.down("KeyQ");
  await waitForCastMode(page, "chain");
  await page.keyboard.up("KeyQ");
  await waitForNoCastMode(page);
  await page.waitForTimeout(120);

  const after = await readDiagnostics(page);
  if (after.spells.cooldowns.chain > before.spells.cooldowns.chain + 0.05) {
    throw new Error(`${viewport.name} out-of-range raw cast target was not rejected when target snap was disabled`);
  }
}

async function aimAtOutOfRangeChainTarget(page) {
  let diagnostics = await readDiagnostics(page);
  const outOfRange = diagnostics.visibilitySamples.visibleOutOfChainRangeCell;
  if (!outOfRange?.screen?.visible) {
    return false;
  }

  await page.mouse.move(outOfRange.screen.x, outOfRange.screen.y);
  await page.waitForTimeout(40);
  diagnostics = await readDiagnostics(page);
  if (groundDistance(diagnostics.input.pointerWorld, diagnostics.player.position) <= 44.5) {
    return false;
  }
  return true;
}

async function verifyHeldClickTracksCamera(page, viewport) {
  const holdPoint = await getVisibleInteractionPoint(page, viewport, 0.72, 0.58);
  await page.mouse.move(holdPoint.x, holdPoint.y);
  const before = await readDiagnostics(page);

  await page.mouse.down();
  try {
    await page.waitForTimeout(120);
    const initialHold = await readDiagnostics(page);

    await page.waitForTimeout(850);
    const afterHold = await readDiagnostics(page);

    const playerMove = groundDistance(afterHold.player.position, before.player.position);
    const targetShift = groundDistance(afterHold.player.navigation.moveTarget, initialHold.player.navigation.moveTarget);

    if (playerMove < 5) {
      throw new Error(`${viewport.name} held-click check did not move the player far enough: ${playerMove}`);
    }
    if (targetShift < 2) {
      throw new Error(`${viewport.name} held-click target did not refresh as the camera moved: ${targetShift}`);
    }
  } finally {
    await page.mouse.up();
  }
}

async function verifyWindowUi(page, viewport) {
  await page.click('[data-ui-action="pause"]');
  await page.waitForSelector('[data-window-id="pause-menu"]:not([hidden])');
  await verifyPauseMenuCentered(page, viewport);

  let diagnostics = await readDiagnostics(page);
  if (!diagnostics.paused) {
    throw new Error("Pause toolbar button did not pause the game");
  }

  await verifyEnemyHealthBarOptions(page);
  await verifyQuickCastOption(page);
  await verifyMaxRangeTargetSnapOption(page);

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

  await setUnlockUi(page, true);
  let locked = await page.$eval('[data-window-id="diagnostics"]', (element) => element.classList.contains("game-window--locked"));
  if (!locked) {
    throw new Error("Diagnostics window should stay locked until Unlock UI controls are used");
  }

  await page.click('[data-window-id="diagnostics"] .game-window__action--lock');
  locked = await page.$eval('[data-window-id="diagnostics"]', (element) => element.classList.contains("game-window--locked"));
  if (locked) {
    throw new Error("Diagnostics lock button did not unlock the window when Unlock UI was on");
  }

  await page.click('[data-window-id="diagnostics"] .game-window__action--lock');
  locked = await page.$eval('[data-window-id="diagnostics"]', (element) => element.classList.contains("game-window--locked"));
  if (!locked) {
    throw new Error("Diagnostics lock button did not lock the window");
  }

  await page.click('[data-window-id="diagnostics"] .game-window__action--close');
  await page.waitForFunction(() => document.querySelector('[data-window-id="diagnostics"]')?.hasAttribute("hidden"));
  await setUnlockUi(page, false);
}

async function verifyPauseMenuCentered(page, viewport) {
  const metrics = await page.$eval('[data-window-id="pause-menu"]', (element) => {
    const rect = element.getBoundingClientRect();
    return {
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
    };
  });

  const xDrift = Math.abs(metrics.centerX - viewport.width / 2);
  const yDrift = Math.abs(metrics.centerY - (viewport.height / 2 - 20));
  if (xDrift > 2 || yDrift > 2) {
    throw new Error(`${viewport.name} pause menu was not centered: ${JSON.stringify(metrics)}`);
  }
}

async function verifyHudTransparency(page, viewport) {
  const initial = await readHudPanelMetrics(page);
  if (!initial.vitals || !initial.game || !initial.abilities) {
    throw new Error(`${viewport.name} missing HUD panel metrics: ${JSON.stringify(initial)}`);
  }

  const panels = [initial.vitals, initial.abilities];

  await verifyUnlockUiDefault(page);

  if (!initial.vitals.text.includes("HP") || !initial.vitals.text.includes("Power")) {
    throw new Error(`${viewport.name} vitals panel did not expose HP and Power labels: ${JSON.stringify(initial.vitals)}`);
  }
  if (initial.vitals.text.includes("Kills") || initial.vitals.text.includes("Wave")) {
    throw new Error(`${viewport.name} vitals panel still contained game progression text: ${JSON.stringify(initial.vitals)}`);
  }
  if (!initial.game.text.includes("Cell") || !initial.game.text.includes("Kills") || !initial.game.text.includes("Wave")) {
    throw new Error(`${viewport.name} game panel did not contain cell, kills, and wave text: ${JSON.stringify(initial.game)}`);
  }
  if (Math.abs(initial.vitals.centerXRatio - 0.5) > 0.08 || Math.abs(initial.abilities.centerXRatio - 0.5) > 0.08) {
    throw new Error(`${viewport.name} central HUD panels were not horizontally centered: ${JSON.stringify(initial)}`);
  }
  if (initial.vitals.centerYRatio < 0.56 || initial.vitals.centerYRatio > 0.7 || initial.abilities.centerYRatio < 0.66 || initial.abilities.centerYRatio > 0.8) {
    throw new Error(`${viewport.name} central HUD panels were not placed around the lower middle of the viewport: ${JSON.stringify(initial)}`);
  }

  for (const panel of panels) {
    if (!panel.locked || !panel.lockControlHidden || panel.titleOpacity > 0.05 || panel.backgroundAlpha > 0.05 || panel.backgroundImage !== "none") {
      throw new Error(`${viewport.name} locked ${panel.id} panel chrome was not transparent: ${JSON.stringify(panel)}`);
    }
  }

  await verifyHudPanelDoesNotHoverReveal(page, viewport, "hud-vitals");
  await verifyHudPanelDoesNotHoverReveal(page, viewport, "hud-abilities");
  await verifyHudPanelClickThrough(page, viewport, "hud-vitals");
  await verifyHudPanelClickThrough(page, viewport, "hud-abilities");

  await setUnlockUi(page, true);
  await verifyHudPanelHoverReveal(page, viewport, "hud-vitals");
  await verifyHudPanelHoverReveal(page, viewport, "hud-abilities");

  const unlockEnabled = await readHudPanelMetrics(page);
  if (unlockEnabled.vitals.lockControlHidden || unlockEnabled.abilities.lockControlHidden) {
    throw new Error(`${viewport.name} Unlock UI did not expose HUD lock controls: ${JSON.stringify(unlockEnabled)}`);
  }

  await revealHudPanel(page, viewport, "hud-vitals");
  await page.click('[data-window-id="hud-vitals"] .game-window__action--lock');
  await page.waitForFunction(() => !document.querySelector('[data-window-id="hud-vitals"]')?.classList.contains("game-window--locked"));

  await setUnlockUi(page, false);
  const disabledAgain = await readHudPanelMetrics(page);
  if (!disabledAgain.vitals.locked || !disabledAgain.vitals.lockControlHidden || !disabledAgain.abilities.lockControlHidden) {
    throw new Error(`${viewport.name} disabling Unlock UI did not force HUD panels locked: ${JSON.stringify(disabledAgain)}`);
  }

  await verifyHudPanelDoesNotHoverReveal(page, viewport, "hud-vitals");
  await verifyHudPanelDoesNotHoverReveal(page, viewport, "hud-abilities");
}

async function verifyHudPanelHoverReveal(page, viewport, id) {
  await revealHudPanel(page, viewport, id);

  const hovered = await readHudPanelMetrics(page);
  const panel = id === "hud-vitals" ? hovered.vitals : hovered.abilities;
  if (panel.titleOpacity < 0.5 || panel.backgroundImage === "none") {
    throw new Error(`${viewport.name} ${id} did not reveal chrome on hover: ${JSON.stringify(panel)}`);
  }

  await page.mouse.move(viewport.width - 4, viewport.height - 4);
  await page.waitForFunction((windowId) => {
    const element = document.querySelector(`[data-window-id="${windowId}"]`);
    const titlebar = element?.querySelector(".game-window__titlebar");
    return !!titlebar && Number(getComputedStyle(titlebar).opacity) < 0.1;
  }, id);
}

async function revealHudPanel(page, viewport, id) {
  const content = page.locator(`[data-window-id="${id}"] .game-window__content`);
  const box = await content.boundingBox();
  if (!box) {
    throw new Error(`${viewport.name} missing ${id} content box`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction((windowId) => {
    const element = document.querySelector(`[data-window-id="${windowId}"]`);
    const titlebar = element?.querySelector(".game-window__titlebar");
    if (!element || !titlebar) {
      return false;
    }

    return Number(getComputedStyle(titlebar).opacity) > 0.5 && getComputedStyle(element).backgroundImage !== "none";
  }, id);
}

async function verifyHudPanelDoesNotHoverReveal(page, viewport, id) {
  const content = page.locator(`[data-window-id="${id}"] .game-window__content`);
  const box = await content.boundingBox();
  if (!box) {
    throw new Error(`${viewport.name} missing ${id} content box`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(220);

  const hovered = await readHudPanelMetrics(page);
  const panel = id === "hud-vitals" ? hovered.vitals : hovered.abilities;
  if (panel.titleOpacity > 0.1 || panel.backgroundImage !== "none") {
    throw new Error(`${viewport.name} ${id} revealed chrome while Unlock UI was off: ${JSON.stringify(panel)}`);
  }
}

async function verifyHudPanelClickThrough(page, viewport, id) {
  const content = page.locator(`[data-window-id="${id}"] .game-window__content`);
  const box = await content.boundingBox();
  if (!box) {
    throw new Error(`${viewport.name} missing ${id} content box`);
  }

  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const hitTarget = await page.evaluate(
    ({ x, y, windowId }) => {
      const target = document.elementFromPoint(x, y);
      return {
        tag: target?.tagName ?? null,
        className: target instanceof HTMLElement ? target.className : "",
        insidePanel: !!target?.closest(`[data-window-id="${windowId}"]`),
      };
    },
    { ...point, windowId: id },
  );

  if (hitTarget.insidePanel) {
    throw new Error(`${viewport.name} ${id} was not click-through while Unlock UI was off: ${JSON.stringify(hitTarget)}`);
  }
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
  for (const mode of ["always", "smart"]) {
    await page.click(`[data-health-mode="${mode}"]`);
    const diagnostics = await readDiagnostics(page);
    if (diagnostics.enemyHealthBars.mode !== mode) {
      throw new Error(`Enemy health bar mode button did not select ${mode}`);
    }
  }
}

async function verifyUnlockUiDefault(page) {
  let diagnostics = await readDiagnostics(page);
  if (diagnostics.input.unlockUiEnabled) {
    throw new Error("Unlock UI should be disabled by default");
  }

  if (!diagnostics.paused) {
    await page.click('[data-ui-action="pause"]');
    await page.waitForSelector('[data-window-id="pause-menu"]:not([hidden])');
  }

  const checked = await page.$eval("[data-unlock-ui]", (input) => input.checked);
  if (checked) {
    throw new Error("Unlock UI toggle did not render disabled by default");
  }

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector('[data-window-id="pause-menu"]')?.hasAttribute("hidden"));
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().paused === false);

  diagnostics = await readDiagnostics(page);
  if (diagnostics.input.unlockUiEnabled) {
    throw new Error("Unlock UI changed while checking default state");
  }
}

async function verifyQuickCastOption(page) {
  let diagnostics = await readDiagnostics(page);
  if (!diagnostics.input.quickCastEnabled) {
    throw new Error("Quick Cast should be enabled by default");
  }

  let checked = await page.$eval("[data-quick-cast]", (input) => input.checked);
  if (!checked) {
    throw new Error("Quick Cast toggle did not render enabled by default");
  }

  await page.click("[data-quick-cast-toggle]");
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().input.quickCastEnabled === false);
  checked = await page.$eval("[data-quick-cast]", (input) => input.checked);
  if (checked) {
    throw new Error("Quick Cast toggle did not turn off");
  }

  await page.click("[data-quick-cast-toggle]");
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().input.quickCastEnabled === true);
  diagnostics = await readDiagnostics(page);
  if (!diagnostics.input.quickCastEnabled) {
    throw new Error("Quick Cast toggle did not turn back on");
  }
}

async function verifyMaxRangeTargetSnapOption(page) {
  let diagnostics = await readDiagnostics(page);
  if (!diagnostics.input.allowMaxRangeTargetSnap) {
    throw new Error("Allow Max Range Target Snap should be enabled by default");
  }

  let checked = await page.$eval("[data-max-range-target-snap]", (input) => input.checked);
  if (!checked) {
    throw new Error("Allow Max Range Target Snap toggle did not render enabled by default");
  }

  await page.click("[data-max-range-target-snap-toggle]");
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().input.allowMaxRangeTargetSnap === false);
  checked = await page.$eval("[data-max-range-target-snap]", (input) => input.checked);
  if (checked) {
    throw new Error("Allow Max Range Target Snap toggle did not turn off");
  }

  await page.click("[data-max-range-target-snap-toggle]");
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().input.allowMaxRangeTargetSnap === true);
  diagnostics = await readDiagnostics(page);
  if (!diagnostics.input.allowMaxRangeTargetSnap) {
    throw new Error("Allow Max Range Target Snap toggle did not turn back on");
  }
}

async function verifyCameraRigStability(page, viewport) {
  const start = await readDiagnostics(page);

  await clickVisibilitySample(page, viewport, start.visibilitySamples?.visibleEastCell, 0.68, 0.56);
  await page.waitForTimeout(260);
  const firstMove = await readDiagnostics(page);

  await clickVisibilitySample(page, viewport, firstMove.visibilitySamples?.visibleWestCell, 0.32, 0.48);
  await page.waitForTimeout(260);
  const secondMove = await readDiagnostics(page);

  const cameraDrift = Math.max(
    quaternionDistance(start.camera.quaternion, firstMove.camera.quaternion),
    quaternionDistance(start.camera.quaternion, secondMove.camera.quaternion),
    quaternionDistance(firstMove.camera.quaternion, secondMove.camera.quaternion),
  );

  const firstIntentX = firstMove.player.navigation.moveTarget[0] - firstMove.player.position[0];
  const secondIntentX = secondMove.player.navigation.moveTarget[0] - secondMove.player.position[0];
  const exercisedOpposingDirection =
    Math.abs(firstMove.player.rotationY - secondMove.player.rotationY) > 0.4 || (firstIntentX > 2 && secondIntentX < -2);
  if (!exercisedOpposingDirection) {
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
  if (!navigation.destinationDiscovered) {
    throw new Error(`${viewport.name} blocker navigation resolved into undiscovered space: ${JSON.stringify(navigation)}`);
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
  if (before.enemyVisibility.visible < 1) {
    throw new Error(`${viewport.name} expected at least one enemy inside current visibility`);
  }

  await page.keyboard.press("KeyV");
  await page.waitForFunction(() => {
    const diagnostics = window.__ZEUS_GAME__?.getDiagnostics();
    const bars = diagnostics?.enemyHealthBars;
    return bars?.mode === "always" && bars.total > 0 && bars.visible === diagnostics.enemyVisibility.visible;
  });

  await page.keyboard.press("KeyV");
  await page.waitForFunction(() => {
    const diagnostics = window.__ZEUS_GAME__?.getDiagnostics();
    const bars = diagnostics?.enemyHealthBars;
    return bars?.mode === "smart" && bars.total > 0 && bars.visible <= diagnostics.enemyVisibility.visible;
  });
}

async function verifyEnemyAvoidance(page, viewport) {
  const before = await readDiagnostics(page);
  if (!before.enemyAvoidance) {
    throw new Error(`${viewport.name} missing enemy avoidance diagnostics`);
  }

  await page.waitForFunction(() => {
    const avoidance = window.__ZEUS_GAME__?.getDiagnostics().enemyAvoidance;
    return avoidance?.enemyCount >= 8 && avoidance.maxNeighbors > 0;
  });

  const after = await readDiagnostics(page);
  const avoidance = after.enemyAvoidance;
  if (avoidance.maxSpeedRatio > 1.05) {
    throw new Error(`${viewport.name} enemy avoidance exceeded speed budget: ${JSON.stringify(avoidance)}`);
  }
  if (avoidance.maxOverlap > 0.95) {
    throw new Error(`${viewport.name} enemy avoidance allowed excessive clumping: ${JSON.stringify(avoidance)}`);
  }
}

async function exerciseCoreInteractions(page, viewport) {
  await reloadGame(page);

  const movePoint = await getVisibleInteractionPoint(page, viewport, 0.62, 0.58);
  await page.mouse.move(movePoint.x, movePoint.y);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.mouse.up();

  const diagnostics = await readDiagnostics(page);
  if (!diagnostics.input.quickCastEnabled) {
    throw new Error(`${viewport.name} expected Quick Cast to be enabled for default spell flow`);
  }

  await verifyQuickCastCancel(page, viewport);
  await verifyQuickCastRelease(page, viewport, "chain", "KeyQ", 0.55, 0.48);
  await verifyQuickCastRelease(page, viewport, "bolt", "KeyW", 0.45, 0.55);

  await reloadGame(page);
  await setMaxRangeTargetSnap(page, false);
  await verifyOutOfRangeCastRejected(page, viewport);
  await setMaxRangeTargetSnap(page, true);
  await verifyOutOfRangeCastSnaps(page, viewport);

  await reloadGame(page);
  await setQuickCast(page, false);
  await verifyLegacyRightClickCancel(page, viewport);
  await verifyLegacyClickCast(page, viewport);
  await setQuickCast(page, true);

  await page.waitForTimeout(700);
}

async function verifyQuickCastCancel(page, viewport) {
  await waitForSpellReady(page, "chain");
  const before = await readDiagnostics(page);

  await page.mouse.move(viewport.width * 0.57, viewport.height * 0.5);
  await releaseSpellKeys(page);
  await page.keyboard.down("KeyQ");
  await waitForCastMode(page, "chain");
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(80);

  const overlap = await readDiagnostics(page);
  if (overlap.spells.castMode !== "chain") {
    throw new Error(`${viewport.name} overlapping quick-cast key replaced the held spell`);
  }
  if (overlap.spells.cooldowns.bolt > before.spells.cooldowns.bolt + 0.05) {
    throw new Error(`${viewport.name} overlapping quick-cast key cast the ignored spell`);
  }

  await page.keyboard.up("KeyW");
  await page.mouse.click(viewport.width * 0.57, viewport.height * 0.5, { button: "right" });
  await waitForNoCastMode(page);
  await page.keyboard.up("KeyQ");
  await page.waitForTimeout(80);

  const after = await readDiagnostics(page);
  if (after.spells.cooldowns.chain > before.spells.cooldowns.chain + 0.05) {
    throw new Error(`${viewport.name} right-click cancel still cast the quick-cast spell`);
  }
}

async function verifyQuickCastRelease(page, viewport, spellId, key, xRatio, yRatio) {
  await waitForSpellReady(page, spellId);
  const target = await getVisibleInteractionPoint(page, viewport, xRatio, yRatio);
  await page.mouse.move(target.x, target.y);
  await releaseSpellKeys(page);
  await page.keyboard.down(key);
  await waitForCastMode(page, spellId);
  await page.keyboard.up(key);
  await waitForSpellCooldown(page, spellId);
  await verifyAbilityCooldownUi(page, viewport, spellId);
}

async function verifyAbilityCooldownUi(page, viewport, spellId) {
  const metrics = await page.$eval(`[data-ability="${spellId}"]`, (button) => {
    const readRect = (selector) => {
      const element = button.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        text: element.textContent?.trim() ?? "",
      };
    };

    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    const fill = button.querySelector(".ability__cooldown-fill");
    return {
      button: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
      },
      classes: [...button.classList],
      cooldownAngle: style.getPropertyValue("--cooldown-angle").trim(),
      cooldownProgress: Number(style.getPropertyValue("--cooldown-progress")),
      fillBackground: fill instanceof HTMLElement ? getComputedStyle(fill).backgroundImage : "",
      key: readRect(".ability__key"),
      icon: readRect(".ability__icon"),
      name: readRect(".ability__name"),
      cooldown: readRect(".ability__cooldown"),
    };
  });

  if (!metrics.classes.includes("ability--cooling") || !(metrics.cooldownProgress > 0) || metrics.cooldownAngle === "0deg") {
    throw new Error(`${viewport.name} ${spellId} ability did not expose active cooldown state: ${JSON.stringify(metrics)}`);
  }
  if (!metrics.fillBackground.includes("conic-gradient")) {
    throw new Error(`${viewport.name} ${spellId} ability did not render radial cooldown fill: ${JSON.stringify(metrics)}`);
  }
  if (!metrics.key?.text || metrics.key.left - metrics.button.left > 12 || metrics.key.top - metrics.button.top > 12) {
    throw new Error(`${viewport.name} ${spellId} ability key was not anchored top-left: ${JSON.stringify(metrics)}`);
  }
  if (!metrics.cooldown?.text || metrics.button.right - metrics.cooldown.right > 14 || metrics.cooldown.top - metrics.button.top > 12) {
    throw new Error(`${viewport.name} ${spellId} cooldown number was not anchored top-right: ${JSON.stringify(metrics)}`);
  }
  if (!metrics.name?.text || Math.abs((metrics.name.left + metrics.name.width / 2) - metrics.button.centerX) > 3 || metrics.button.bottom - metrics.name.bottom > 9) {
    throw new Error(`${viewport.name} ${spellId} ability name was not centered at the bottom: ${JSON.stringify(metrics)}`);
  }
  if (!metrics.icon || Math.abs((metrics.icon.left + metrics.icon.width / 2) - metrics.button.centerX) > 3 || Math.abs((metrics.icon.top + metrics.icon.height / 2) - metrics.button.centerY) > 3) {
    throw new Error(`${viewport.name} ${spellId} ability icon was not centered: ${JSON.stringify(metrics)}`);
  }
}

async function verifyLegacyRightClickCancel(page, viewport) {
  await waitForSpellReady(page, "bolt");
  const before = await readDiagnostics(page);

  await releaseSpellKeys(page);
  await page.keyboard.press("KeyW");
  await waitForCastMode(page, "bolt");
  await page.mouse.click(viewport.width * 0.46, viewport.height * 0.54, { button: "right" });
  await waitForNoCastMode(page);
  await page.waitForTimeout(80);

  const after = await readDiagnostics(page);
  if (after.spells.cooldowns.bolt > before.spells.cooldowns.bolt + 0.05) {
    throw new Error(`${viewport.name} right-click cancel still cast the legacy targeted spell`);
  }
}

async function verifyLegacyClickCast(page, viewport) {
  await waitForSpellReady(page, "chain");
  const target = await getVisibleInteractionPoint(page, viewport, 0.55, 0.48);
  await releaseSpellKeys(page);
  await page.keyboard.press("KeyQ");
  await waitForCastMode(page, "chain");
  await page.mouse.click(target.x, target.y);
  await waitForSpellCooldown(page, "chain");
}

async function setQuickCast(page, enabled) {
  const diagnostics = await readDiagnostics(page);
  if (!diagnostics.paused) {
    await page.click('[data-ui-action="pause"]');
    await page.waitForSelector('[data-window-id="pause-menu"]:not([hidden])');
  }

  if (diagnostics.input.quickCastEnabled !== enabled) {
    await page.click("[data-quick-cast-toggle]");
    await page.waitForFunction((expected) => window.__ZEUS_GAME__?.getDiagnostics().input.quickCastEnabled === expected, enabled);
  }

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector('[data-window-id="pause-menu"]')?.hasAttribute("hidden"));
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().paused === false);
}

async function setMaxRangeTargetSnap(page, enabled) {
  const diagnostics = await readDiagnostics(page);
  if (!diagnostics.paused) {
    await page.click('[data-ui-action="pause"]');
    await page.waitForSelector('[data-window-id="pause-menu"]:not([hidden])');
  }

  if (diagnostics.input.allowMaxRangeTargetSnap !== enabled) {
    await page.click("[data-max-range-target-snap-toggle]");
    await page.waitForFunction(
      (expected) => window.__ZEUS_GAME__?.getDiagnostics().input.allowMaxRangeTargetSnap === expected,
      enabled,
    );
  }

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector('[data-window-id="pause-menu"]')?.hasAttribute("hidden"));
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().paused === false);
}

async function setUnlockUi(page, enabled) {
  const diagnostics = await readDiagnostics(page);
  if (!diagnostics.paused) {
    await page.click('[data-ui-action="pause"]');
    await page.waitForSelector('[data-window-id="pause-menu"]:not([hidden])');
  }

  if (diagnostics.input.unlockUiEnabled !== enabled) {
    await page.click("[data-unlock-ui-toggle]");
    await page.waitForFunction((expected) => window.__ZEUS_GAME__?.getDiagnostics().input.unlockUiEnabled === expected, enabled);
  }

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector('[data-window-id="pause-menu"]')?.hasAttribute("hidden"));
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().paused === false);
}

async function waitForSpellReady(page, spellId) {
  await page.waitForFunction(
    ({ id, manaCost }) => {
      const diagnostics = window.__ZEUS_GAME__?.getDiagnostics();
      return diagnostics && !diagnostics.paused && diagnostics.spells.cooldowns[id] <= 0.05 && diagnostics.spells.mana >= manaCost;
    },
    { id: spellId, manaCost: spellManaCosts[spellId] },
    { timeout: 6000 },
  );
}

async function releaseSpellKeys(page) {
  await page.keyboard.up("KeyQ");
  await page.keyboard.up("KeyW");
}

async function waitForSpellCooldown(page, spellId) {
  await page.waitForFunction((id) => {
    const diagnostics = window.__ZEUS_GAME__?.getDiagnostics();
    return diagnostics && !diagnostics.spells.castMode && diagnostics.spells.cooldowns[id] > 0.2;
  }, spellId);
}

async function waitForCastMode(page, spellId) {
  await page.waitForFunction((id) => window.__ZEUS_GAME__?.getDiagnostics().spells.castMode === id, spellId);
}

async function waitForNoCastMode(page) {
  await page.waitForFunction(() => !window.__ZEUS_GAME__?.getDiagnostics().spells.castMode);
}

async function reloadGame(page) {
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForSelector(".ui-layer");
  await page.waitForSelector(".hud__stats");
  await page.waitForSelector(".ui-toolbar");
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

async function getVisibleInteractionPoint(page, viewport, fallbackXRatio, fallbackYRatio) {
  const diagnostics = await readDiagnostics(page);
  const candidates = [
    diagnostics.visibilitySamples?.visibleMoveCell,
    diagnostics.visibilitySamples?.visibleEastCell,
    diagnostics.visibilitySamples?.visibleWestCell,
  ];
  for (const sample of candidates) {
    if (sample?.screen?.visible) {
      return { x: sample.screen.x, y: sample.screen.y };
    }
  }

  return { x: viewport.width * fallbackXRatio, y: viewport.height * fallbackYRatio };
}

async function clickVisibleMoveCell(page, viewport, fallbackXRatio, fallbackYRatio) {
  const point = await getVisibleInteractionPoint(page, viewport, fallbackXRatio, fallbackYRatio);
  await page.mouse.click(point.x, point.y);
  return point;
}

async function clickVisibilitySample(page, viewport, sample, fallbackXRatio, fallbackYRatio) {
  if (sample?.screen?.visible) {
    await page.mouse.click(sample.screen.x, sample.screen.y);
    return { x: sample.screen.x, y: sample.screen.y };
  }

  const point = { x: viewport.width * fallbackXRatio, y: viewport.height * fallbackYRatio };
  await page.mouse.click(point.x, point.y);
  return point;
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

async function readHudPanelMetrics(page) {
  return page.evaluate(() => {
    const readAlpha = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) {
        return 1;
      }

      const parts = match[1].split(",").map((part) => Number(part.trim()));
      return parts.length >= 4 ? parts[3] : 1;
    };

    const readPanel = (id) => {
      const element = document.querySelector(`[data-window-id="${id}"]`);
      const titlebar = element?.querySelector(".game-window__titlebar");
      const lockButton = element?.querySelector(".game-window__action--lock");
      if (!(element instanceof HTMLElement) || !(titlebar instanceof HTMLElement)) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const lockButtonStyle = lockButton instanceof HTMLElement ? getComputedStyle(lockButton) : null;
      return {
        id,
        text: element.innerText,
        locked: element.classList.contains("game-window--locked"),
        lockControlHidden:
          !(lockButton instanceof HTMLButtonElement) ||
          lockButton.hidden ||
          lockButton.disabled ||
          lockButtonStyle?.display === "none" ||
          lockButtonStyle?.visibility === "hidden",
        titleOpacity: Number(getComputedStyle(titlebar).opacity),
        backgroundAlpha: readAlpha(style.backgroundColor),
        backgroundImage: style.backgroundImage,
        centerXRatio: (rect.left + rect.width / 2) / window.innerWidth,
        centerYRatio: (rect.top + rect.height / 2) / window.innerHeight,
      };
    };

    return {
      vitals: readPanel("hud-vitals"),
      game: readPanel("hud-position"),
      abilities: readPanel("hud-abilities"),
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

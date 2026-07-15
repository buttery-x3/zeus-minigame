import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const url = process.env.VERIFY_URL ?? "http://127.0.0.1:5174/zeus/";
const parsedUrl = new URL(url);
const port = process.env.VERIFY_PORT ?? (parsedUrl.port || "5173");
const basePath = parsedUrl.pathname.endsWith("/") ? parsedUrl.pathname : `${parsedUrl.pathname}/`;
const browserPath = await resolveBrowserPath();
const spellManaCosts = {
  chain: 22,
  bolt: 34,
};
const viewports = [
  { name: "desktop", width: 1280, height: 720 },
];

let devServer = null;

try {
  if (!(await isReachable(url))) {
    devServer = await startDevServer();
  }

  const results = await verifyInBrowser();
  for (const result of results) {
    console.log(`${result.viewport.name}: passed`);
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
      await waitForPlayerModel(page, viewport);
      await verifyPlayerAnimationLifecycle(page, viewport);
      await verifyEnemyAnimationLifecycle(page, viewport);
      await verifyPotatoRendering(page, viewport);
      await verifyAudioSystem(page, viewport);

      await reloadGame(page);
      await verifyGamePreferencesPersistence(page, viewport);
      await verifyHudTransparency(page, viewport);
      await reloadGame(page);
      await verifyFrameTiming(page, viewport);
      await reloadGame(page);
      await verifyTerrainGrammar(page, viewport);
      await verifyGroundEffects(page, viewport);
      await reloadGame(page);
      await verifyUpgradeChoices(page, viewport);
      await reloadGame(page);
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

      const hud = await collectHudMetrics(page);
      const result = { viewport, hud, errors };
      assertPageResult(result);
      await verifyTerrainDebugMode(page, viewport);
      results.push(result);

      await page.close();
    }
  } finally {
    await browser.close();
  }

  return results;
}

async function verifyAudioSystem(page, viewport) {
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().audio?.loadState === "ready");
  await page.mouse.click(viewport.width * 0.5, viewport.height * 0.5);
  await page.waitForFunction(() => {
    const audio = window.__ZEUS_GAME__?.getDiagnostics().audio;
    return audio?.unlocked && audio.contextState === "running" && audio.music?.playing;
  });

  const initial = await readDiagnostics(page);
  if (
    initial.audio.configuredCueCount !== 8 ||
    initial.audio.loadedVariantCount !== 13 ||
    initial.audio.optionalUnavailable.length !== 0 ||
    initial.audio.preferences.sfxVolume !== 1 ||
    initial.audio.preferences.bgmVolume !== 0.35 ||
    initial.audio.preferences.spellFailureEnabled ||
    initial.audio.music.source !== `${basePath}assets/audio/music/storm-arena-loop.mp3` ||
    !initial.audio.music.loop ||
    initial.audio.music.loadState === "error"
  ) {
    throw new Error(`${viewport.name} audio catalog did not preload correctly: ${JSON.stringify(initial.audio)}`);
  }
  const expectedVolumes = {
    "spell-chain-cast": 0.576,
    "spell-bolt-cast": 0.576,
    "minion-death": 0.651,
    "new-wave-announce": 0.455,
    "charged-tile-channeling": 0.528,
    "cursed-tile-channeling": 0.456,
  };
  for (const [cueId, expectedVolume] of Object.entries(expectedVolumes)) {
    if (Math.abs(initial.audio.cueVolumes[cueId] - expectedVolume) > 0.0001) {
      throw new Error(`${viewport.name} ${cueId} had the wrong mix volume: ${JSON.stringify(initial.audio.cueVolumes)}`);
    }
  }
  if (
    initial.audio.cooldownFailurePitch.detuneCents !== -1200 ||
    initial.audio.cooldownFailurePitch.randomDetuneCents !== 45
  ) {
    throw new Error(`${viewport.name} cooldown failure pitch was not configured correctly: ${JSON.stringify(initial.audio)}`);
  }
  await page.waitForFunction(
    ({ startTime, expectedGain }) => {
      const audio = window.__ZEUS_GAME__?.getDiagnostics().audio;
      return (
        audio?.music?.playing &&
        audio.music.currentTime > startTime + 0.1 &&
        Math.abs(audio.effectiveBgmGain - expectedGain) < 0.02
      );
    },
    { startTime: initial.audio.music.currentTime, expectedGain: 0.35 },
  );

  const target = await getVisibleInteractionPoint(page, viewport, 0.55, 0.48);
  await page.mouse.move(target.x, target.y);
  await releaseSpellKeys(page);
  await page.keyboard.down("KeyQ");
  await waitForCastMode(page, "chain");
  await page.keyboard.up("KeyQ");
  await waitForSpellCooldown(page, "chain");
  await page.waitForFunction(
    (before) => window.__ZEUS_GAME__?.getDiagnostics().audio?.playCounts?.["spell-chain-cast"] > before,
    initial.audio.playCounts["spell-chain-cast"],
  );

  const beforeCooldownFailure = await readDiagnostics(page);
  await page.keyboard.press("KeyQ");
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().audio?.lastCastFailureReason === "cooldown");
  let diagnostics = await readDiagnostics(page);
  if (diagnostics.audio.playCounts["spell-cast-failed"] !== beforeCooldownFailure.audio.playCounts["spell-cast-failed"]) {
    throw new Error(`${viewport.name} spell-failure SFX played while disabled: ${JSON.stringify(diagnostics.audio)}`);
  }

  const musicBeforePause = diagnostics.audio.music.currentTime;
  await page.click('[data-ui-action="pause"]');
  await page.waitForSelector('[data-window-id="pause-menu"]:not([hidden])');
  await page.waitForFunction(() => {
    const audio = window.__ZEUS_GAME__?.getDiagnostics().audio;
    return audio?.suspensionReasons.includes("pause") && audio.effectiveSfxGain < 0.02;
  });
  const defaultControls = await readAudioControls(page);
  if (
    defaultControls.sfx !== "100" ||
    defaultControls.bgm !== "35" ||
    defaultControls.sfxOutput !== "100%" ||
    defaultControls.bgmOutput !== "35%" ||
    defaultControls.spellFailureEnabled
  ) {
    throw new Error(`${viewport.name} audio controls had incorrect defaults: ${JSON.stringify(defaultControls)}`);
  }
  await page.waitForFunction(
    (startTime) => {
      const audio = window.__ZEUS_GAME__?.getDiagnostics().audio;
      return audio?.music?.playing && audio.contextState === "running" && audio.music.currentTime > startTime + 0.1;
    },
    musicBeforePause,
  );

  await setRangeInput(page, "[data-sfx-volume]", 64);
  await setRangeInput(page, "[data-bgm-volume]", 22);
  await page.click("[data-spell-failure-sfx-toggle]");
  await page.waitForFunction(() => {
    const audio = window.__ZEUS_GAME__?.getDiagnostics().audio;
    return (
      audio?.preferences.sfxVolume === 0.64 &&
      audio.preferences.bgmVolume === 0.22 &&
      audio.preferences.spellFailureEnabled &&
      Math.abs(audio.effectiveBgmGain - 0.22) < 0.02
    );
  });
  const changedControls = await readAudioControls(page);
  if (changedControls.sfxOutput !== "64%" || changedControls.bgmOutput !== "22%" || !changedControls.spellFailureEnabled) {
    throw new Error(`${viewport.name} audio controls did not update live: ${JSON.stringify(changedControls)}`);
  }

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const audio = window.__ZEUS_GAME__?.getDiagnostics().audio;
    return !window.__ZEUS_GAME__?.getDiagnostics().paused && Math.abs(audio.effectiveSfxGain - 0.64) < 0.02;
  });

  const beforeEnabledFailure = await readDiagnostics(page);
  await page.keyboard.press("KeyQ");
  await page.waitForFunction(
    (before) => {
      const audio = window.__ZEUS_GAME__?.getDiagnostics().audio;
      const detune = audio?.lastDetuneCents?.["spell-cast-failed"];
      return (
        audio?.lastCastFailureReason === "cooldown" &&
        audio.playCounts["spell-cast-failed"] > before &&
        detune >= -1245 &&
        detune <= -1155
      );
    },
    beforeEnabledFailure.audio.playCounts["spell-cast-failed"],
  );

  await page.evaluate(() => window.__ZEUS_GAME__?.setPlayerManaForVerification(0));
  await page.keyboard.press("KeyW");
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().audio?.lastCastFailureReason === "out-of-mana");

  const beforeEnemyDeath = await readDiagnostics(page);
  const defeatedEnemy = await page.evaluate(() => window.__ZEUS_GAME__?.defeatEnemyForVerification());
  if (!defeatedEnemy) {
    throw new Error(`${viewport.name} could not defeat an enemy for audio verification`);
  }
  await page.waitForFunction(
    (before) => window.__ZEUS_GAME__?.getDiagnostics().audio?.playCounts?.["minion-death"] > before,
    beforeEnemyDeath.audio.playCounts["minion-death"],
  );

  const beforeNewWave = await readDiagnostics(page);
  const startedWave = await page.evaluate(() => window.__ZEUS_GAME__?.startNextWaveForVerification());
  if (!startedWave) {
    throw new Error(`${viewport.name} could not start a wave for audio verification`);
  }
  await page.waitForFunction(
    (before) => window.__ZEUS_GAME__?.getDiagnostics().audio?.playCounts?.["new-wave-announce"] > before,
    beforeNewWave.audio.playCounts["new-wave-announce"],
  );

  const beforePlayerHit = await readDiagnostics(page);
  await page.evaluate(() => window.__ZEUS_GAME__?.defeatPlayerForVerification());
  await page.waitForFunction(
    (before) => window.__ZEUS_GAME__?.getDiagnostics().audio?.playCounts?.["player-hit"] > before,
    beforePlayerHit.audio.playCounts["player-hit"],
  );
  const musicBeforeRestart = beforePlayerHit.audio.music.currentTime;
  await page.keyboard.press("KeyR");
  await page.waitForFunction(() => {
    const current = window.__ZEUS_GAME__?.getDiagnostics();
    return current && !current.gameOver && current.audio.music.playing;
  });
  diagnostics = await readDiagnostics(page);
  if (diagnostics.audio.music.currentTime <= musicBeforeRestart) {
    throw new Error(`${viewport.name} game restart reset BGM playback: ${JSON.stringify(diagnostics.audio.music)}`);
  }

  await reloadGame(page);
  diagnostics = await readDiagnostics(page);
  if (
    diagnostics.audio.preferences.sfxVolume !== 0.64 ||
    diagnostics.audio.preferences.bgmVolume !== 0.22 ||
    !diagnostics.audio.preferences.spellFailureEnabled
  ) {
    throw new Error(`${viewport.name} audio preferences did not persist across reload: ${JSON.stringify(diagnostics.audio)}`);
  }
  await page.click('[data-ui-action="pause"]');
  await page.waitForSelector('[data-window-id="pause-menu"]:not([hidden])');
  const persistedControls = await readAudioControls(page);
  if (persistedControls.sfx !== "64" || persistedControls.bgm !== "22" || !persistedControls.spellFailureEnabled) {
    throw new Error(`${viewport.name} persisted audio controls did not render correctly: ${JSON.stringify(persistedControls)}`);
  }

  await setRangeInput(page, "[data-sfx-volume]", 100);
  await setRangeInput(page, "[data-bgm-volume]", 35);
  await page.click("[data-spell-failure-sfx-toggle]");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const audio = window.__ZEUS_GAME__?.getDiagnostics().audio;
    return (
      !window.__ZEUS_GAME__?.getDiagnostics().paused &&
      audio.preferences.sfxVolume === 1 &&
      audio.preferences.bgmVolume === 0.35 &&
      !audio.preferences.spellFailureEnabled &&
      Math.abs(audio.effectiveSfxGain - 1) < 0.02
    );
  });
}

async function setRangeInput(page, selector, value) {
  await page.$eval(
    selector,
    (input, nextValue) => {
      input.value = String(nextValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value,
  );
}

async function readAudioControls(page) {
  return page.evaluate(() => ({
    sfx: document.querySelector("[data-sfx-volume]")?.value,
    bgm: document.querySelector("[data-bgm-volume]")?.value,
    sfxOutput: document.querySelector("[data-sfx-volume-output]")?.value,
    bgmOutput: document.querySelector("[data-bgm-volume-output]")?.value,
    spellFailureEnabled: document.querySelector("[data-spell-failure-sfx]")?.checked,
  }));
}

async function verifyGamePreferencesPersistence(page, viewport) {
  const storageKey = "zeus.settings.v1";
  await page.evaluate((key) => window.localStorage.removeItem(key), storageKey);
  await reloadGame(page);

  await page.click('[data-ui-action="pause"]');
  await page.waitForSelector('[data-window-id="pause-menu"]:not([hidden])');
  await page.click('[data-health-mode="always"]');
  await page.click("[data-quick-cast-toggle]");
  await page.click("[data-max-range-target-snap-toggle]");
  await page.click("[data-unlock-ui-toggle]");
  await page.click("[data-potato-mode-toggle]");
  await page.click("[data-terrain-debug-toggle]");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().paused === false);

  const moves = [
    { id: "hud-vitals", dx: 52, dy: -34 },
    { id: "hud-status", dx: -48, dy: 42 },
    { id: "hud-position", dx: -58, dy: 34 },
    { id: "hud-abilities", dx: -44, dy: -38 },
    { id: "hud-currencies", dx: 68, dy: -48 },
  ];
  for (const move of moves) {
    await dragHudPanel(page, viewport, move.id, move.dx, move.dy);
  }
  const movedBounds = await readPanelBounds(page, moves.map(({ id }) => id));

  await page.waitForFunction(
    ({ key, panelIds }) => {
      const stored = window.localStorage.getItem(key);
      if (!stored) {
        return false;
      }
      const settings = JSON.parse(stored);
      return (
        settings.enemyHealthBarMode === "always" &&
        settings.quickCastEnabled === false &&
        settings.allowMaxRangeTargetSnap === false &&
        settings.unlockUiEnabled === true &&
        settings.renderMode === "potato" &&
        panelIds.every((id) => Number.isFinite(settings.hudPanelPositions?.[id]?.x) && Number.isFinite(settings.hudPanelPositions?.[id]?.y))
      );
    },
    { key: storageKey, panelIds: moves.map(({ id }) => id) },
  );

  await reloadGame(page);
  let diagnostics = await readDiagnostics(page);
  if (
    diagnostics.enemyHealthBars.mode !== "always" ||
    diagnostics.input.quickCastEnabled ||
    diagnostics.input.allowMaxRangeTargetSnap ||
    !diagnostics.input.unlockUiEnabled ||
    diagnostics.input.renderMode !== "potato" ||
    diagnostics.input.terrainDebugMode
  ) {
    throw new Error(`${viewport.name} game preferences did not restore correctly: ${JSON.stringify(diagnostics.input)}`);
  }

  const restoredBounds = await readPanelBounds(page, moves.map(({ id }) => id));
  for (const { id } of moves) {
    const before = movedBounds[id];
    const after = restoredBounds[id];
    if (!before || !after || Math.hypot(after.left - before.left, after.top - before.top) > 2) {
      throw new Error(`${viewport.name} ${id} position did not persist: before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`);
    }
  }

  await page.click('[data-ui-action="pause"]');
  await page.waitForSelector('[data-window-id="pause-menu"]:not([hidden])');
  const controls = await readGamePreferenceControls(page);
  if (
    controls.enemyHealthBarMode !== "always" ||
    controls.quickCastEnabled ||
    controls.allowMaxRangeTargetSnap ||
    !controls.unlockUiEnabled ||
    !controls.potatoMode ||
    controls.terrainDebugMode
  ) {
    throw new Error(`${viewport.name} persisted game preferences did not render in the menu: ${JSON.stringify(controls)}`);
  }
  await page.keyboard.press("Escape");

  await page.evaluate(
    ({ key }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          enemyHealthBarMode: "invalid",
          quickCastEnabled: "invalid",
          allowMaxRangeTargetSnap: false,
          unlockUiEnabled: true,
          renderMode: "invalid",
          terrainDebugMode: true,
          hudPanelPositions: {
            "hud-vitals": { x: 2, y: -1 },
            "hud-status": { x: "invalid", y: 0.25 },
          },
        }),
      );
    },
    { key: storageKey },
  );
  await reloadGame(page);
  diagnostics = await readDiagnostics(page);
  if (
    diagnostics.enemyHealthBars.mode !== "smart" ||
    !diagnostics.input.quickCastEnabled ||
    diagnostics.input.allowMaxRangeTargetSnap ||
    !diagnostics.input.unlockUiEnabled ||
    diagnostics.input.renderMode !== "normal" ||
    diagnostics.input.terrainDebugMode
  ) {
    throw new Error(`${viewport.name} partial game preferences did not fall back field-by-field: ${JSON.stringify(diagnostics.input)}`);
  }

  await page.evaluate(({ key }) => window.localStorage.setItem(key, "{"), { key: storageKey });
  await reloadGame(page);
  diagnostics = await readDiagnostics(page);
  if (
    diagnostics.enemyHealthBars.mode !== "smart" ||
    !diagnostics.input.quickCastEnabled ||
    !diagnostics.input.allowMaxRangeTargetSnap ||
    diagnostics.input.unlockUiEnabled ||
    diagnostics.input.renderMode !== "normal" ||
    diagnostics.input.terrainDebugMode
  ) {
    throw new Error(`${viewport.name} malformed game preferences did not fall back to defaults: ${JSON.stringify(diagnostics.input)}`);
  }

  await page.evaluate((key) => window.localStorage.removeItem(key), storageKey);
  await reloadGame(page);
}

async function readGamePreferenceControls(page) {
  return page.evaluate(() => ({
    enemyHealthBarMode: document.querySelector('[data-health-mode][aria-checked="true"]')?.getAttribute("data-health-mode"),
    quickCastEnabled: document.querySelector("[data-quick-cast]")?.checked,
    allowMaxRangeTargetSnap: document.querySelector("[data-max-range-target-snap]")?.checked,
    unlockUiEnabled: document.querySelector("[data-unlock-ui]")?.checked,
    potatoMode: document.querySelector("[data-potato-mode]")?.checked,
    terrainDebugMode: document.querySelector("[data-terrain-debug]")?.checked,
  }));
}

async function dragHudPanel(page, viewport, id, dx, dy) {
  const titlebar = page.locator(`[data-window-id="${id}"] .game-window__titlebar`);
  const box = await titlebar.boundingBox();
  if (!box) {
    throw new Error(`${viewport.name} could not drag missing ${id} titlebar`);
  }

  const start = { x: box.x + Math.min(12, box.width / 2), y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 4 });
  await page.mouse.up();
}

async function readPanelBounds(page, ids) {
  return page.evaluate((panelIds) => {
    return Object.fromEntries(
      panelIds.map((id) => {
        const rect = document.querySelector(`[data-window-id="${id}"]`)?.getBoundingClientRect();
        return [id, rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : null];
      }),
    );
  }, ids);
}

async function verifyFrameTiming(page, viewport) {
  const initial = await readDiagnostics(page);
  if (
    initial.timing?.maxStepSeconds !== 0.05 ||
    initial.timing?.maxCatchUpSeconds !== 0.25 ||
    typeof initial.timing?.multiStepFrameCount !== "number"
  ) {
    throw new Error(`${viewport.name} missing bounded simulation timing diagnostics: ${JSON.stringify(initial.timing)}`);
  }

  const target = await getVisibleInteractionPoint(page, viewport, 0.55, 0.48);
  await page.mouse.move(target.x, target.y);
  await releaseSpellKeys(page);
  await page.keyboard.down("KeyQ");
  await waitForCastMode(page, "chain");
  await page.keyboard.up("KeyQ");
  await waitForSpellCooldown(page, "chain");

  const beforeHitch = await readDiagnostics(page);
  const multiStepFramesBefore = beforeHitch.timing.multiStepFrameCount;
  await stallMainThreadOnAnimationFrame(page, 180);
  await page.waitForFunction(
    (previousCount) => window.__ZEUS_GAME__?.getDiagnostics().timing?.multiStepFrameCount > previousCount,
    multiStepFramesBefore,
  );

  const afterHitch = await readDiagnostics(page);
  const catchUp = afterHitch.timing.lastMultiStepFrame;
  const expectedSimulated = Math.min(catchUp?.rawDeltaSeconds ?? 0, afterHitch.timing.maxCatchUpSeconds);
  const cooldownRecovered = beforeHitch.spells.cooldowns.chain - afterHitch.spells.cooldowns.chain;
  if (
    !catchUp ||
    catchUp.rawDeltaSeconds < 0.14 ||
    catchUp.substeps < 3 ||
    Math.abs(catchUp.simulatedDeltaSeconds - expectedSimulated) > 0.01 ||
    cooldownRecovered < expectedSimulated - 0.04
  ) {
    throw new Error(
      `${viewport.name} lagged frame did not catch up simulation time: timing=${JSON.stringify(afterHitch.timing)}, cooldownRecovered=${cooldownRecovered}`,
    );
  }

  const multiStepFramesBeforeCap = afterHitch.timing.multiStepFrameCount;
  await stallMainThreadOnAnimationFrame(page, 320);
  await page.waitForFunction(
    (previousCount) => window.__ZEUS_GAME__?.getDiagnostics().timing?.multiStepFrameCount > previousCount,
    multiStepFramesBeforeCap,
  );
  const afterCappedHitch = await readDiagnostics(page);
  const cappedCatchUp = afterCappedHitch.timing.lastMultiStepFrame;
  if (
    !cappedCatchUp ||
    cappedCatchUp.rawDeltaSeconds < 0.28 ||
    cappedCatchUp.substeps !== 5 ||
    Math.abs(cappedCatchUp.simulatedDeltaSeconds - afterCappedHitch.timing.maxCatchUpSeconds) > 0.01 ||
    cappedCatchUp.cappedSeconds < 0.03
  ) {
    throw new Error(`${viewport.name} long lagged frame was not bounded: ${JSON.stringify(afterCappedHitch.timing)}`);
  }

  await page.click('[data-ui-action="pause"]');
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().paused === true);
  const pausedStart = await readDiagnostics(page);
  await stallMainThread(page, 160);
  await page.waitForTimeout(50);
  const pausedEnd = await readDiagnostics(page);
  if (
    Math.abs(pausedStart.spells.cooldowns.chain - pausedEnd.spells.cooldowns.chain) > 0.02 ||
    Math.abs(pausedStart.player.animation.animationTime - pausedEnd.player.animation.animationTime) > 0.001 ||
    !pausedEnd.timing.paused ||
    pausedEnd.timing.simulatedDeltaSeconds !== 0 ||
    pausedEnd.timing.substeps !== 0
  ) {
    throw new Error(`${viewport.name} pause advanced during a lagged frame: ${JSON.stringify(pausedEnd.timing)}`);
  }
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().paused === false);

  const beforeVisibilityReset = await readDiagnostics(page);
  await page.evaluate((duration) => {
    document.dispatchEvent(new Event("visibilitychange"));
    const deadline = performance.now() + duration;
    while (performance.now() < deadline) {
      // Keep the visibility reset and blocked interval in the same browser task.
    }
  }, 160);
  await page.waitForFunction(
    (discardedBefore) => window.__ZEUS_GAME__?.getDiagnostics().timing?.totalVisibilityDiscardedSeconds > discardedBefore + 0.12,
    beforeVisibilityReset.timing.totalVisibilityDiscardedSeconds,
  );
  const afterVisibilityReset = await readDiagnostics(page);
  const visibilityRecovery = beforeVisibilityReset.spells.cooldowns.chain - afterVisibilityReset.spells.cooldowns.chain;
  if (visibilityRecovery > 0.1) {
    throw new Error(
      `${viewport.name} visibility reset caught up hidden time: recovery=${visibilityRecovery}, timing=${JSON.stringify(afterVisibilityReset.timing)}`,
    );
  }
}

async function verifyTerrainGrammar(page, viewport) {
  const diagnostics = await readDiagnostics(page);
  const grammar = diagnostics.terrainGrammar;
  if (!grammar) {
    throw new Error(`${viewport.name} missing terrain diagnostics`);
  }
  const wfc = grammar.wfc;
  if (!wfc) {
    throw new Error(`${viewport.name} missing terrain WFC diagnostics: ${JSON.stringify(grammar)}`);
  }
  if (wfc.fellBack) {
    throw new Error(`${viewport.name} rolling patch terrain fell back instead of solving: ${JSON.stringify(wfc)}`);
  }
  if (wfc.mode !== "rolling-patch" || wfc.patchRadius !== 2 || wfc.activePatchRadius < 3 || wfc.committedPatchCount < 37) {
    throw new Error(`${viewport.name} rolling patch terrain resolved an unexpected active set: ${JSON.stringify(wfc)}`);
  }
  if (wfc.emergencyPatchCount > 0 || wfc.contradictionCount > 0) {
    throw new Error(`${viewport.name} rolling patch terrain used emergency patches: ${JSON.stringify(wfc)}`);
  }
  if (wfc.synthesisFailureCount > 0 || wfc.authoredPatchCount < 1 || wfc.authoredPatchCount <= wfc.proceduralPatchCount) {
    throw new Error(`${viewport.name} authored-first terrain synthesis was invalid: ${JSON.stringify(wfc)}`);
  }
  if (
    !wfc.structureCounts ||
    wfc.structureCounts.open < 1 ||
    wfc.structureCounts.river < 1 ||
    wfc.structureCounts.lake < 1 ||
    wfc.structureCounts.bank !== 0
  ) {
    throw new Error(`${viewport.name} rolling patch terrain did not produce the authored terrain vocabulary: ${JSON.stringify(wfc)}`);
  }
  if (
    !wfc.topologySelectionCounts ||
    (wfc.topologySelectionCounts["gentle-bend"] ?? 0) < 1 ||
    !wfc.shortLoopCandidatesSuppressed ||
    wfc.shortLoopCandidatesSuppressed.wall + wfc.shortLoopCandidatesSuppressed.river < 1
  ) {
    throw new Error(`${viewport.name} authored terrain topology policy was inactive: ${JSON.stringify(wfc)}`);
  }
  if (!wfc.surfaceCounts || wfc.surfaceCounts.charged < 1 || wfc.surfaceCounts.cursed < 1) {
    throw new Error(`${viewport.name} rolling terrain did not produce charged and cursed ground: ${JSON.stringify(wfc.surfaceCounts)}`);
  }
  if (wfc.surfaceCounts.cursed >= wfc.surfaceCounts.charged) {
    throw new Error(`${viewport.name} cursed ground was not rarer than charged ground: ${JSON.stringify(wfc.surfaceCounts)}`);
  }
  if (wfc.patchSocketMismatchSample) {
    throw new Error(`${viewport.name} rolling patch terrain produced a socket mismatch: ${JSON.stringify(wfc.patchSocketMismatchSample)}`);
  }
}

async function stallMainThreadOnAnimationFrame(page, durationMs) {
  await page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          const deadline = performance.now() + duration;
          while (performance.now() < deadline) {
            // Intentionally block one rendered frame to verify simulation catch-up.
          }
          resolve();
        });
      }),
    durationMs,
  );
}

async function stallMainThread(page, durationMs) {
  await page.evaluate((duration) => {
    const deadline = performance.now() + duration;
    while (performance.now() < deadline) {
      // Intentionally block the page thread to exercise pause and visibility timing.
    }
  }, durationMs);
}

async function verifyGroundEffects(page, viewport) {
  await page.keyboard.press("F4");
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().input.terrainDebugMode === true);

  try {
    let diagnostics = await readDiagnostics(page);
    if (
      diagnostics.terrain?.specialGround?.activeParticleSystems !== 0 ||
      diagnostics.terrain?.specialGround?.activeParticleCount !== 0 ||
      diagnostics.terrain?.specialGround?.ambientUpdatesPerSecond !== 0 ||
      diagnostics.terrain?.specialGround?.animatedTileCount !== 0 ||
      diagnostics.terrain?.specialGround?.activationSource !== "player-cell" ||
      diagnostics.terrain?.specialGround?.particleSizeMultiplier !== 8 ||
      diagnostics.player?.navigation?.groundAuraColor !== "#f2a43a"
    ) {
      throw new Error(`${viewport.name} special ground performed dormant tile work: ${JSON.stringify(diagnostics.terrain?.specialGround)}`);
    }
    let charged = diagnostics.groundSamples?.nearestChargedCell;
    if (!charged?.screen?.visible) {
      throw new Error(`${viewport.name} missing a reachable charged-ground sample: ${JSON.stringify(diagnostics.terrainGrammar?.wfc?.surfaceCounts)}`);
    }

    await page.mouse.click(charged.screen.x, charged.screen.y);
    await page.waitForFunction(
      ({ q, r }) => {
        const ground = window.__ZEUS_GAME__?.getDiagnostics().groundEffects;
        return ground?.cell?.q === q && ground?.cell?.r === r && ground.phase === "charged" && ground.cooldownRecoveryMultiplier > 1.7;
      },
      charged.cell,
      { timeout: 6000 },
    );

    const chargedAudio = (await readDiagnostics(page)).audio;
    if (chargedAudio.activeLoop !== "charged-tile-channeling" || !chargedAudio.loopPlaying) {
      throw new Error(`${viewport.name} charged ground did not start the channeling cue: ${JSON.stringify(chargedAudio)}`);
    }

    const chargedKey = `${charged.cell.q},${charged.cell.r}`;
    const target = await getVisibleInteractionPoint(page, viewport, 0.55, 0.48);
    await page.mouse.move(target.x, target.y);
    await releaseSpellKeys(page);
    await page.keyboard.down("KeyQ");
    await waitForCastMode(page, "chain");
    await page.keyboard.up("KeyQ");
    await waitForSpellCooldown(page, "chain");

    const recoveryStart = await readDiagnostics(page);
    await page.waitForTimeout(420);
    const recoveryEnd = await readDiagnostics(page);
    const cooldownRecovered = recoveryStart.spells.cooldowns.chain - recoveryEnd.spells.cooldowns.chain;
    const powerRecovered = recoveryEnd.spells.mana - recoveryStart.spells.mana;
    if (cooldownRecovered < 0.58 || powerRecovered < 4.6) {
      throw new Error(`${viewport.name} charged ground did not accelerate cooldown and Power recovery: cooldown=${cooldownRecovered}, power=${powerRecovered}`);
    }
    if (
      recoveryEnd.groundEffects.cooldownRecoveryMultiplier < 1.7 ||
      recoveryEnd.groundEffects.energyRecoveryMultiplier < 1.7
    ) {
      throw new Error(`${viewport.name} charged recovery multipliers were not active: ${JSON.stringify(recoveryEnd.groundEffects)}`);
    }
    if (
      recoveryEnd.terrain?.specialGround?.activeParticleSystems !== 1 ||
      recoveryEnd.terrain?.specialGround?.activeParticleCount !== 7 ||
      recoveryEnd.terrain?.specialGround?.activeParticleKind !== "charged" ||
      recoveryEnd.terrain?.specialGround?.animatedTileCount !== 1 ||
      recoveryEnd.player?.navigation?.groundAuraMode !== "charged" ||
      recoveryEnd.player?.navigation?.groundAuraColor !== "#ffc857" ||
      recoveryEnd.player?.navigation?.groundCellKey !== chargedKey
    ) {
      throw new Error(`${viewport.name} charged ground did not use the single active particle system: ${JSON.stringify(recoveryEnd.terrain?.specialGround)}`);
    }

    await clickVisibleMoveCell(page, viewport, 0.34, 0.55);
    await page.waitForFunction(
      ({ q, r }) => {
        const cell = window.__ZEUS_GAME__?.getDiagnostics().groundEffects?.cell;
        return cell && (cell.q !== q || cell.r !== r);
      },
      charged.cell,
      { timeout: 6000 },
    );
    const awayStart = await readDiagnostics(page);
    const usedBeforeWaitingAway = chargedUsageFor(awayStart, chargedKey);
    await page.waitForTimeout(360);
    const away = await readDiagnostics(page);
    const usedWhileAway = chargedUsageFor(away, chargedKey);
    if (
      Math.abs(usedWhileAway - usedBeforeWaitingAway) > 0.03 ||
      away.groundEffects.cooldownRecoveryMultiplier !== 1 ||
      away.terrain?.specialGround?.activeParticleSystems !== 0 ||
      away.terrain?.specialGround?.animatedTileCount !== 0 ||
      away.audio.activeLoop !== null
    ) {
      throw new Error(`${viewport.name} charged-ground capacity did not pause after leaving: before=${usedBeforeWaitingAway}, away=${usedWhileAway}`);
    }

    diagnostics = await readDiagnostics(page);
    charged = diagnostics.groundSamples?.partiallyChargedCell;
    if (!charged?.screen?.visible || `${charged.cell.q},${charged.cell.r}` !== chargedKey) {
      throw new Error(`${viewport.name} could not reacquire the partially consumed charged tile`);
    }
    await page.mouse.click(charged.screen.x, charged.screen.y);
    await page.waitForFunction(
      ({ q, r }) => {
        const ground = window.__ZEUS_GAME__?.getDiagnostics().groundEffects;
        return ground?.cell?.q === q && ground?.cell?.r === r && ground.cooldownRecoveryMultiplier > 1;
      },
      charged.cell,
      { timeout: 6000 },
    );
    await page.waitForFunction(
      (key) => {
        const diagnostics = window.__ZEUS_GAME__?.getDiagnostics();
        const usage = diagnostics?.groundEffects?.chargedCells?.find((entry) => entry.key === key);
        return (
          usage?.remainingSeconds <= 0 &&
          diagnostics.groundEffects.phase === "depleted" &&
          diagnostics.groundEffects.cooldownRecoveryMultiplier === 1 &&
          diagnostics.groundEffects.energyRecoveryMultiplier === 1 &&
          diagnostics.audio.activeLoop === null
        );
      },
      chargedKey,
      { timeout: 5000 },
    );
    diagnostics = await readDiagnostics(page);
    if (
      diagnostics.groundEffects.cooldownRecoveryMultiplier !== 1 ||
      diagnostics.groundEffects.energyRecoveryMultiplier !== 1 ||
      diagnostics.audio.activeLoop !== null
    ) {
      throw new Error(`${viewport.name} depleted charged ground still granted recovery: ${JSON.stringify(diagnostics.groundEffects)}`);
    }

    let cursed = diagnostics.groundSamples?.nearestCursedCell;
    if (!cursed?.screen?.visible) {
      throw new Error(`${viewport.name} missing a reachable cursed-ground sample: ${JSON.stringify(diagnostics.terrainGrammar?.wfc?.surfaceCounts)}`);
    }
    await page.mouse.click(cursed.screen.x, cursed.screen.y);
    await page.waitForFunction(
      ({ q, r }) => {
        const ground = window.__ZEUS_GAME__?.getDiagnostics().groundEffects;
        return ground?.cell?.q === q && ground?.cell?.r === r && ground.phase === "cursed" && ground.curseProgress > 0.12;
      },
      cursed.cell,
      { timeout: 6000 },
    );
    diagnostics = await readDiagnostics(page);
    if (
      diagnostics.terrain?.specialGround?.activeParticleSystems !== 1 ||
      diagnostics.terrain?.specialGround?.activeParticleKind !== "cursed" ||
      diagnostics.terrain?.specialGround?.animatedTileCount !== 1 ||
      diagnostics.player?.navigation?.groundAuraColor !== "#d475ff" ||
      diagnostics.audio.activeLoop !== "cursed-tile-channeling" ||
      !diagnostics.audio.loopPlaying
    ) {
      throw new Error(`${viewport.name} cursed ground did not activate focused particles: ${JSON.stringify(diagnostics.terrain?.specialGround)}`);
    }

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().paused === true);
    await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().audio?.suspensionReasons.includes("pause"));
    const pausedStart = await readDiagnostics(page);
    await page.waitForTimeout(360);
    const pausedEnd = await readDiagnostics(page);
    if (Math.abs(pausedEnd.groundEffects.curseProgress - pausedStart.groundEffects.curseProgress) > 0.01) {
      throw new Error(`${viewport.name} curse cleansing advanced while paused`);
    }
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => {
      const diagnostics = window.__ZEUS_GAME__?.getDiagnostics();
      return diagnostics && !diagnostics.paused && !diagnostics.audio.suspensionReasons.includes("pause");
    });

    const cursedCell = cursed.cell;
    await clickVisibleMoveCell(page, viewport, 0.67, 0.54);
    await page.waitForFunction(
      ({ q, r }) => {
        const cell = window.__ZEUS_GAME__?.getDiagnostics().groundEffects?.cell;
        return cell && (cell.q !== q || cell.r !== r);
      },
      cursedCell,
      { timeout: 6000 },
    );
    const leftCurse = await readDiagnostics(page);
    if (leftCurse.groundEffects.curseProgress !== 0 || leftCurse.audio.activeLoop !== null) {
      throw new Error(`${viewport.name} curse progress did not reset after leaving`);
    }

    diagnostics = await readDiagnostics(page);
    cursed = diagnostics.groundSamples?.nearestCursedCell;
    if (!cursed?.screen?.visible || cursed.cell.q !== cursedCell.q || cursed.cell.r !== cursedCell.r) {
      throw new Error(`${viewport.name} could not reacquire the reset cursed tile`);
    }
    await page.mouse.click(cursed.screen.x, cursed.screen.y);
    await page.waitForFunction(
      () => {
        const ground = window.__ZEUS_GAME__?.getDiagnostics().groundEffects;
        return ground?.cursedEnergy === 1 && ground.cleansedCount === 1;
      },
      undefined,
      { timeout: 7000 },
    );
    diagnostics = await readDiagnostics(page);
    const currencyText = await page.$eval('[data-window-id="hud-currencies"] [data-cursed-energy]', (element) => element.textContent);
    if (
      currencyText?.trim() !== "1" ||
      diagnostics.groundEffects.phase !== "cleansed" ||
      diagnostics.terrain?.specialGround?.activeParticleSystems !== 0 ||
      diagnostics.terrain?.specialGround?.animatedTileCount !== 0 ||
      diagnostics.audio.activeLoop !== null
    ) {
      throw new Error(`${viewport.name} cursed-ground reward or HUD currency did not update: ${currencyText}, ${JSON.stringify(diagnostics.groundEffects)}`);
    }
    if (diagnostics.pauseReason !== "upgrade" || !diagnostics.upgrades?.offer || !diagnostics.paused) {
      throw new Error(`${viewport.name} cursed-ground reward did not open a paused upgrade offer: ${JSON.stringify(diagnostics.upgrades)}`);
    }
    await page.click('[data-upgrade-skip]');
    await page.waitForFunction(() => !window.__ZEUS_GAME__?.getDiagnostics().paused);
  } finally {
    const diagnostics = await readDiagnostics(page);
    if (diagnostics.input.terrainDebugMode) {
      await page.keyboard.press("F4");
      await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().input.terrainDebugMode === false);
    }
  }
}

async function verifyUpgradeChoices(page, viewport) {
  const opened = await page.evaluate(() =>
    window.__ZEUS_GAME__?.openUpgradeOfferForVerification(1, ["healthRegen", "spellCooldown", "shield"]),
  );
  if (!opened) {
    throw new Error(`${viewport.name} could not open a deterministic upgrade offer`);
  }
  await page.waitForSelector('[data-window-id="upgrade-choice"]:not([hidden])');

  const initial = await readDiagnostics(page);
  const costs = initial.upgrades.offer?.cards.map((card) => card.cost).sort((a, b) => a - b);
  if (
    initial.pauseReason !== "upgrade" ||
    !initial.paused ||
    initial.upgrades.offer?.durationSeconds !== 10 ||
    JSON.stringify(costs) !== JSON.stringify([1, 2, 3])
  ) {
    throw new Error(`${viewport.name} upgrade offer did not expose the required pause, duration, and costs: ${JSON.stringify(initial.upgrades)}`);
  }

  const cardState = await page.$$eval("[data-upgrade-id]", (buttons) =>
    buttons.map((button) => ({
      id: button.getAttribute("data-upgrade-id"),
      cost: Number(button.getAttribute("data-upgrade-cost")),
      disabled: button.disabled,
    })),
  );
  if (
    cardState.length !== 3 ||
    new Set(cardState.map((card) => card.id)).size !== 3 ||
    cardState.filter((card) => !card.disabled).length !== 1 ||
    cardState.find((card) => !card.disabled)?.cost !== 1
  ) {
    throw new Error(`${viewport.name} upgrade affordability or uniqueness was incorrect: ${JSON.stringify(cardState)}`);
  }

  const windowMetrics = await page.$eval('[data-window-id="upgrade-choice"]', (element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });
  if (
    windowMetrics.left < 8 ||
    windowMetrics.right > viewport.width - 8 ||
    windowMetrics.top < 8 ||
    windowMetrics.bottom > viewport.height - 8
  ) {
    throw new Error(`${viewport.name} upgrade choice did not fit the supported viewport: ${JSON.stringify(windowMetrics)}`);
  }

  await page.waitForTimeout(360);
  const timerAdvanced = await readDiagnostics(page);
  if (
    timerAdvanced.upgrades.offer.remainingSeconds >= initial.upgrades.offer.remainingSeconds - 0.2 ||
    Math.abs(timerAdvanced.player.animation.animationTime - initial.player.animation.animationTime) > 0.001 ||
    timerAdvanced.timing.substeps !== 0 ||
    !timerAdvanced.audio.suspensionReasons.includes("pause")
  ) {
    throw new Error(`${viewport.name} upgrade timer did not advance independently of frozen gameplay: ${JSON.stringify(timerAdvanced.upgrades.offer)}`);
  }

  await page.keyboard.press("Escape");
  const afterEscape = await readDiagnostics(page);
  if (afterEscape.pauseReason !== "upgrade" || !afterEscape.upgrades.offer) {
    throw new Error(`${viewport.name} Escape bypassed the active upgrade offer`);
  }

  await page.click("[data-upgrade-skip]");
  await page.waitForFunction(() => !window.__ZEUS_GAME__?.getDiagnostics().paused);
  let diagnostics = await readDiagnostics(page);
  if (diagnostics.groundEffects.cursedEnergy !== 1 || diagnostics.upgrades.offer !== null) {
    throw new Error(`${viewport.name} saving Cursed Energy changed the balance or retained the offer`);
  }

  await page.evaluate(() =>
    window.__ZEUS_GAME__?.openUpgradeOfferForVerification(3, ["maxVitals", "spellCooldown", "shield"]),
  );
  await page.waitForSelector('[data-window-id="upgrade-choice"]:not([hidden])');
  const maxVitalsCard = await page.evaluate(() =>
    window.__ZEUS_GAME__?.getDiagnostics().upgrades.offer.cards.find((card) => card.id === "maxVitals"),
  );
  await page.click('[data-upgrade-id="maxVitals"]');
  await page.waitForFunction(() => !window.__ZEUS_GAME__?.getDiagnostics().paused);
  diagnostics = await readDiagnostics(page);
  if (
    diagnostics.groundEffects.cursedEnergy !== 3 - maxVitalsCard.cost ||
    diagnostics.upgrades.stacks.maxVitals !== 1 ||
    Math.abs(diagnostics.upgrades.stats.maxHealth - 132) > 0.001 ||
    Math.abs(diagnostics.upgrades.stats.maxMana - 110) > 0.001 ||
    Math.abs(diagnostics.player.health - 132) > 0.05 ||
    Math.abs(diagnostics.spells.mana - 110) > 0.05
  ) {
    throw new Error(`${viewport.name} max-vitals selection did not spend or apply correctly: ${JSON.stringify(diagnostics.upgrades)}`);
  }

  const remainingUpgrades = [
    "healthRegen",
    "manaRegen",
    "spellCooldown",
    "spellCost",
    "moveSpeed",
    "shield",
    "spellDamage",
    "chainBounce",
    "boltDamage",
  ];
  const applied = await page.evaluate((upgradeIds) =>
    upgradeIds.map((upgradeId) => window.__ZEUS_GAME__?.applyUpgradeForVerification(upgradeId)),
    remainingUpgrades,
  );
  if (applied.some((result) => result !== true)) {
    throw new Error(`${viewport.name} could not apply every upgrade for deterministic verification: ${JSON.stringify(applied)}`);
  }

  diagnostics = await readDiagnostics(page);
  const stats = diagnostics.upgrades.stats;
  if (
    Math.abs(stats.healthRegenPerSecond - 0.2) > 0.001 ||
    Math.abs(stats.manaRegenPerSecond - 8.7) > 0.001 ||
    Math.abs(stats.spellCooldownMultiplier - 0.95) > 0.001 ||
    Math.abs(stats.spellCostMultiplier - 0.95) > 0.001 ||
    Math.abs(stats.moveSpeed - 18.9) > 0.001 ||
    Math.abs(stats.spellDamageMultiplier - 1.1) > 0.001 ||
    stats.chainExtraBounces !== 1 ||
    Math.abs(stats.boltDamageMultiplier - 1.25) > 0.001 ||
    Math.abs(diagnostics.spells.effectiveConfig.chain.cooldown - 2.8 * 0.95) > 0.001 ||
    Math.abs(diagnostics.spells.effectiveConfig.bolt.manaCost - 34 * 0.95) > 0.001 ||
    !diagnostics.upgrades.shield.ready
  ) {
    throw new Error(`${viewport.name} derived upgrade stats were incorrect: ${JSON.stringify(diagnostics.upgrades)}`);
  }

  const shieldDamage = await page.evaluate(() => {
    const game = window.__ZEUS_GAME__;
    const before = game.getDiagnostics().player.health;
    game.damagePlayerForVerification(7);
    const afterShield = game.getDiagnostics();
    game.damagePlayerForVerification(7);
    const afterDamage = game.getDiagnostics();
    return {
      before,
      afterShieldHealth: afterShield.player.health,
      afterDamageHealth: afterDamage.player.health,
      shield: afterShield.upgrades.shield,
    };
  });
  if (
    shieldDamage.afterShieldHealth !== shieldDamage.before ||
    shieldDamage.afterDamageHealth !== shieldDamage.before - 7 ||
    shieldDamage.shield.ready ||
    shieldDamage.shield.rechargeRemainingSeconds < 29.9
  ) {
    throw new Error(`${viewport.name} shield did not absorb exactly one damage instance: ${JSON.stringify(shieldDamage)}`);
  }
  await page.evaluate(() => window.__ZEUS_GAME__?.advanceShieldRechargeForVerification(30));
  diagnostics = await readDiagnostics(page);
  if (!diagnostics.upgrades.shield.ready || diagnostics.upgrades.shield.rechargeRemainingSeconds !== 0) {
    throw new Error(`${viewport.name} shield did not replenish after 30 active seconds`);
  }

  const buildText = await page.$eval("[data-upgrade-summary]", (element) => element.textContent);
  if (!buildText?.includes("Aegis of Storms") || !buildText.includes("Shield ready")) {
    throw new Error(`${viewport.name} HUD did not expose the acquired build and shield state: ${buildText}`);
  }

  await page.evaluate(() =>
    window.__ZEUS_GAME__?.openUpgradeOfferForVerification(2, ["manaRegen", "moveSpeed", "boltDamage"]),
  );
  await page.waitForSelector('[data-window-id="upgrade-choice"]:not([hidden])');
  await page.waitForFunction(
    () => document.querySelector('[data-window-id="upgrade-choice"]')?.hasAttribute("hidden"),
    undefined,
    { timeout: 12000 },
  );
  diagnostics = await readDiagnostics(page);
  if (diagnostics.paused || diagnostics.upgrades.offer !== null || diagnostics.groundEffects.cursedEnergy !== 2) {
    throw new Error(`${viewport.name} timed-out offer did not default to saving energy`);
  }
}

function chargedUsageFor(diagnostics, key) {
  return diagnostics.groundEffects.chargedCells.find((entry) => entry.key === key)?.usedSeconds ?? 0;
}

async function verifyTerrainDebugMode(page, viewport) {
  const before = await readDiagnostics(page);
  const beforeProjection = before.camera?.projection ?? {};
  const beforeHeight = Math.abs((beforeProjection.top ?? 0) - (beforeProjection.bottom ?? 0));
  const beforeRadius = before.terrainGrammar?.wfc?.activePatchRadius;
  const beforeGeneratedPatches = before.terrainGrammar?.wfc?.generatedPatchCount;
  const beforeBlockers = before.terrain?.blockers?.total ?? 0;

  await page.keyboard.press("F4");
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().input.terrainDebugMode === true);
  await page.waitForTimeout(350);

  const after = await readDiagnostics(page);
  if (!after.input.terrainDebugMode) {
    throw new Error(`${viewport.name} terrain debug mode did not enable`);
  }
  if (!after.visibilityOverlay?.debugReveal || after.visibilityOverlay?.visible) {
    throw new Error(`${viewport.name} terrain debug mode did not disable fog overlay: ${JSON.stringify(after.visibilityOverlay)}`);
  }
  const afterProjection = after.camera?.projection ?? {};
  const afterHeight = Math.abs((afterProjection.top ?? 0) - (afterProjection.bottom ?? 0));
  if (beforeHeight <= 0 || afterHeight < beforeHeight * 2.9) {
    throw new Error(`${viewport.name} terrain debug mode did not widen camera view: before=${beforeHeight}, after=${afterHeight}`);
  }
  const lowerFrustumOriginY = cameraLowerFrustumOriginY(after.camera);
  if (lowerFrustumOriginY <= 4) {
    throw new Error(`${viewport.name} terrain debug camera lower frustum starts below usable ground clearance: ${lowerFrustumOriginY}`);
  }
  if (after.player.health !== 120) {
    throw new Error(`${viewport.name} terrain debug mode did not keep player health full: ${after.player.health}`);
  }
  if (after.terrainGrammar?.wfc?.activePatchRadius !== beforeRadius) {
    throw new Error(`${viewport.name} terrain debug mode changed generation radius: ${JSON.stringify(after.terrainGrammar?.wfc)}`);
  }
  if (after.terrainGrammar?.wfc?.generatedPatchCount !== beforeGeneratedPatches) {
    throw new Error(`${viewport.name} terrain debug mode generated new patches: before=${beforeGeneratedPatches}, after=${after.terrainGrammar?.wfc?.generatedPatchCount}`);
  }
  if ((after.terrain?.blockers?.total ?? 0) <= beforeBlockers) {
    throw new Error(`${viewport.name} terrain debug mode did not expand rendered terrain window: before=${beforeBlockers}, after=${after.terrain?.blockers?.total}`);
  }
  if (
    after.terrainGrammar?.wfc?.emergencyPatchCount > 0 ||
    after.terrainGrammar?.wfc?.synthesisFailureCount > 0 ||
    after.terrainGrammar?.wfc?.patchSocketMismatchSample
  ) {
    throw new Error(`${viewport.name} terrain debug mode terrain diagnostics invalid: ${JSON.stringify(after.terrainGrammar?.wfc)}`);
  }

  await page.keyboard.press("F4");
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().input.terrainDebugMode === false);
  await page.waitForTimeout(500);

  const restored = await readDiagnostics(page);
  const restoredProjection = restored.camera?.projection ?? {};
  const restoredHeight = Math.abs((restoredProjection.top ?? 0) - (restoredProjection.bottom ?? 0));
  if (restoredHeight > beforeHeight * 1.1) {
    throw new Error(`${viewport.name} terrain debug mode did not restore camera view: beforeHeight=${beforeHeight}, restoredHeight=${restoredHeight}`);
  }
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
  assertContinuousVisibilityOverlay(viewport, start, "initial");
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
  assertContinuousVisibilityOverlay(viewport, afterMove, "after exploration");
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
  if (after.audio.lastCastFailureReason !== "hidden-target") {
    throw new Error(`${viewport.name} hidden cast reported the wrong audio failure reason: ${JSON.stringify(after.audio)}`);
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
  if (after.audio.lastCastFailureReason !== "out-of-range") {
    throw new Error(`${viewport.name} strict-range cast reported the wrong audio failure reason: ${JSON.stringify(after.audio)}`);
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
    await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().player.animation.activeClip === "Run_03");
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
    if (initialHold.player.animation.activeState !== "run" || initialHold.player.animation.activeClip !== "Run_03") {
      throw new Error(`${viewport.name} movement did not use Run_03: ${JSON.stringify(initialHold.player.animation)}`);
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
  if (locked) {
    throw new Error("Diagnostics window should unlock when Unlock UI is enabled");
  }

  await page.click('[data-window-id="diagnostics"] .game-window__action--lock');
  locked = await page.$eval('[data-window-id="diagnostics"]', (element) => element.classList.contains("game-window--locked"));
  if (!locked) {
    throw new Error("Diagnostics lock button did not lock the window");
  }

  await page.click('[data-window-id="diagnostics"] .game-window__action--lock');
  locked = await page.$eval('[data-window-id="diagnostics"]', (element) => element.classList.contains("game-window--locked"));
  if (locked) {
    throw new Error("Diagnostics lock button did not unlock the window");
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
  if (xDrift > 2 || yDrift > 2 || metrics.height > viewport.height - 16) {
    throw new Error(`${viewport.name} pause menu was not centered: ${JSON.stringify(metrics)}`);
  }
}

async function verifyHudTransparency(page, viewport) {
  const initial = await readHudPanelMetrics(page);
  if (!initial.vitals || !initial.status || !initial.game || !initial.abilities || !initial.currencies) {
    throw new Error(`${viewport.name} missing HUD panel metrics: ${JSON.stringify(initial)}`);
  }

  const minimalPanelIds = ["hud-vitals", "hud-status", "hud-position", "hud-abilities", "hud-currencies"];
  const panels = minimalPanelIds.map((id) => getHudPanelMetric(initial, id));

  await verifyUnlockUiDefault(page);

  if (!initial.vitals.text.includes("HP") || !initial.vitals.text.includes("Power")) {
    throw new Error(`${viewport.name} vitals panel did not expose HP and Power labels: ${JSON.stringify(initial.vitals)}`);
  }
  if (initial.vitals.text.includes("Kills") || initial.vitals.text.includes("Wave")) {
    throw new Error(`${viewport.name} vitals panel still contained game progression text: ${JSON.stringify(initial.vitals)}`);
  }
  if (!initial.game.text.includes("Hex") || !initial.game.text.includes("Kills") || !initial.game.text.includes("Wave")) {
    throw new Error(`${viewport.name} game panel did not contain hex, kills, and wave text: ${JSON.stringify(initial.game)}`);
  }
  if (!initial.currencies.text.includes("Cursed Energy") || !initial.currencies.text.includes("0")) {
    throw new Error(`${viewport.name} currency panel did not expose the initial Cursed Energy balance: ${JSON.stringify(initial.currencies)}`);
  }
  if (initial.currencies.centerXRatio > 0.32 || initial.currencies.centerYRatio < 0.86) {
    throw new Error(`${viewport.name} currency panel was not placed at the bottom-left: ${JSON.stringify(initial.currencies)}`);
  }
  if (Math.abs(initial.vitals.centerXRatio - 0.5) > 0.08 || Math.abs(initial.abilities.centerXRatio - 0.5) > 0.08) {
    throw new Error(`${viewport.name} central HUD panels were not horizontally centered: ${JSON.stringify(initial)}`);
  }
  if (
    initial.abilities.centerYRatio < 0.66 ||
    initial.abilities.centerYRatio > 0.8 ||
    initial.vitals.centerYRatio < 0.78 ||
    initial.vitals.centerYRatio > 0.9 ||
    initial.vitals.centerYRatio <= initial.abilities.centerYRatio
  ) {
    throw new Error(`${viewport.name} vitals panel was not placed below the ability panel: ${JSON.stringify(initial)}`);
  }

  for (const panel of panels) {
    if (!panel.locked || !panel.lockControlHidden || panel.titleOpacity > 0.05 || panel.backgroundAlpha > 0.05 || panel.backgroundImage !== "none") {
      throw new Error(`${viewport.name} locked ${panel.id} panel chrome was not transparent: ${JSON.stringify(panel)}`);
    }
  }

  for (const id of minimalPanelIds) {
    await verifyHudPanelDoesNotHoverReveal(page, viewport, id);
    await verifyHudPanelClickThrough(page, viewport, id);
  }

  await verifyCurrencyPanelBottomGrowth(page, viewport);

  await setUnlockUi(page, true);
  const unlockEnabled = await readHudPanelMetrics(page);
  if (
    minimalPanelIds.some((id) => {
      const panel = getHudPanelMetric(unlockEnabled, id);
      return panel.locked || panel.lockControlHidden || panel.titleOpacity < 0.5 || panel.backgroundImage === "none";
    })
  ) {
    throw new Error(`${viewport.name} Unlock UI did not expose unlocked HUD panels: ${JSON.stringify(unlockEnabled)}`);
  }
  await verifyCurrencyPanelMovement(page, viewport);

  await page.click('[data-window-id="hud-vitals"] .game-window__action--lock');
  await page.waitForFunction(() => document.querySelector('[data-window-id="hud-vitals"]')?.classList.contains("game-window--locked"));
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await verifyHudPanelHoverReveal(page, viewport, "hud-vitals");

  await setUnlockUi(page, false);
  const disabledAgain = await readHudPanelMetrics(page);
  if (minimalPanelIds.some((id) => !getHudPanelMetric(disabledAgain, id).locked || !getHudPanelMetric(disabledAgain, id).lockControlHidden)) {
    throw new Error(`${viewport.name} disabling Unlock UI did not force HUD panels locked: ${JSON.stringify(disabledAgain)}`);
  }

  for (const id of minimalPanelIds) {
    await verifyHudPanelDoesNotHoverReveal(page, viewport, id);
  }
}

async function verifyCurrencyPanelMovement(page, viewport) {
  const before = await page.$eval('[data-window-id="hud-currencies"]', (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  const titlebar = page.locator('[data-window-id="hud-currencies"] .game-window__titlebar');
  const box = await titlebar.boundingBox();
  if (!box) {
    throw new Error(`${viewport.name} currency panel titlebar was not draggable`);
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 28, box.y + box.height / 2 - 18, { steps: 4 });
  await page.mouse.up();

  const after = await page.$eval('[data-window-id="hud-currencies"]', (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  if (Math.hypot(after.x - before.x, after.y - before.y) < 12) {
    throw new Error(`${viewport.name} currency panel did not move while unlocked: before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`);
  }

  await page.click('[data-window-id="hud-currencies"] .game-window__action--lock');
  await page.waitForFunction(() => document.querySelector('[data-window-id="hud-currencies"]')?.classList.contains("game-window--locked"));
  await revealHudPanel(page, viewport, "hud-currencies");
  await page.click('[data-window-id="hud-currencies"] .game-window__action--lock');
  await page.waitForFunction(() => !document.querySelector('[data-window-id="hud-currencies"]')?.classList.contains("game-window--locked"));
}

async function verifyCurrencyPanelBottomGrowth(page, viewport) {
  const before = await page.$eval('[data-window-id="hud-currencies"]', (element) => {
    const panelRect = element.getBoundingClientRect();
    const currencyRect = element.querySelector('[data-currency="cursed"]')?.getBoundingClientRect();
    return {
      top: panelRect.top,
      bottom: panelRect.bottom,
      height: panelRect.height,
      currencyBottom: currencyRect?.bottom ?? 0,
    };
  });
  const upgradeIds = [
    "maxVitals",
    "healthRegen",
    "manaRegen",
    "moveSpeed",
    "spellCooldown",
    "spellCost",
    "chainBounce",
    "spellDamage",
    "boltDamage",
    "shield",
  ];
  const applied = await page.evaluate((ids) => ids.map((id) => window.__ZEUS_GAME__?.applyUpgradeForVerification(id)), upgradeIds);
  if (applied.some((result) => result !== true)) {
    throw new Error(`${viewport.name} could not expand the currency panel for bottom-alignment verification: ${JSON.stringify(applied)}`);
  }

  await page.waitForFunction(
    ({ previousHeight, expectedBottom }) => {
      const element = document.querySelector('[data-window-id="hud-currencies"]');
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.height > previousHeight + 10 && Math.abs(rect.bottom - expectedBottom) <= 2;
    },
    { previousHeight: before.height, expectedBottom: before.bottom },
  );

  const after = await page.$eval('[data-window-id="hud-currencies"]', (element) => {
    const panelRect = element.getBoundingClientRect();
    const currencyRect = element.querySelector('[data-currency="cursed"]')?.getBoundingClientRect();
    return {
      top: panelRect.top,
      bottom: panelRect.bottom,
      height: panelRect.height,
      currencyBottom: currencyRect?.bottom ?? 0,
    };
  });
  if (
    after.top >= before.top - 10 ||
    Math.abs(after.bottom - before.bottom) > 2 ||
    Math.abs(after.currencyBottom - before.currencyBottom) > 2 ||
    after.top < 0 ||
    after.bottom > viewport.height
  ) {
    throw new Error(`${viewport.name} currency panel did not expand upward from its bottom edge: before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`);
  }
}

async function verifyHudPanelHoverReveal(page, viewport, id) {
  await revealHudPanel(page, viewport, id);

  const hovered = await readHudPanelMetrics(page);
  const panel = getHudPanelMetric(hovered, id);
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
    const lockButton = element?.querySelector(".game-window__action--lock");
    if (!element || !titlebar) {
      return false;
    }

    const lockRect = lockButton?.getBoundingClientRect();
    const lockButtonInViewport =
      !lockRect ||
      (lockRect.top >= 0 && lockRect.left >= 0 && lockRect.bottom <= window.innerHeight && lockRect.right <= window.innerWidth);

    return Number(getComputedStyle(titlebar).opacity) > 0.5 && getComputedStyle(element).backgroundImage !== "none" && lockButtonInViewport;
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
  const panel = getHudPanelMetric(hovered, id);
  if (panel.titleOpacity > 0.1 || panel.backgroundImage !== "none") {
    throw new Error(`${viewport.name} ${id} revealed chrome while Unlock UI was off: ${JSON.stringify(panel)}`);
  }
}

function getHudPanelMetric(metrics, id) {
  const keyById = {
    "hud-vitals": "vitals",
    "hud-status": "status",
    "hud-position": "game",
    "hud-abilities": "abilities",
    "hud-currencies": "currencies",
  };
  return metrics[keyById[id]];
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
  if (after.player.animation.activeClip === "mage_soell_cast_3") {
    throw new Error(`${viewport.name} cancelled Chain Lightning still triggered its cast animation`);
  }
}

async function verifyQuickCastRelease(page, viewport, spellId, key, xRatio, yRatio) {
  await waitForSpellReady(page, spellId);
  const target = await getVisibleInteractionPoint(page, viewport, xRatio, yRatio);
  await page.mouse.move(target.x, target.y);
  const beforeCast = await readDiagnostics(page);
  await releaseSpellKeys(page);
  await page.keyboard.down(key);
  await waitForCastMode(page, spellId);
  await page.keyboard.up(key);
  await waitForSpellCooldown(page, spellId);
  const expectedClip = spellId === "chain" ? "mage_soell_cast_3" : "mage_soell_cast";
  await page.waitForFunction(
    (clip) => window.__ZEUS_GAME__?.getDiagnostics().player.animation.activeClip === clip,
    expectedClip,
  );
  const duringCast = await readDiagnostics(page);
  const audioCue = spellId === "chain" ? "spell-chain-cast" : "spell-bolt-cast";
  const castTarget = beforeCast.input.pointerWorld;
  const castOrigin = beforeCast.player.position;
  const expectedRotation = Math.atan2(castTarget[0] - castOrigin[0], castTarget[2] - castOrigin[2]);
  if (duringCast.player.animation.timeScale !== 5) {
    throw new Error(`${viewport.name} ${spellId} cast animation did not run at 5x: ${JSON.stringify(duringCast.player.animation)}`);
  }
  if (angleDistance(duringCast.player.rotationY, expectedRotation) > 0.08) {
    throw new Error(
      `${viewport.name} ${spellId} cast did not face its target: rotation=${duringCast.player.rotationY}, expected=${expectedRotation}`,
    );
  }
  if (duringCast.audio.playCounts[audioCue] !== beforeCast.audio.playCounts[audioCue] + 1) {
    throw new Error(`${viewport.name} ${spellId} cast did not play exactly one cast cue: ${JSON.stringify(duringCast.audio)}`);
  }
  await verifyAbilityCooldownUi(page, viewport, spellId);
}

async function verifyPlayerAnimationLifecycle(page, viewport) {
  const expectedClips = [
    "Dead",
    "Idle_8",
    "Run_03",
    "Running",
    "Walking",
    "mage_soell_cast_3",
    "mage_soell_cast",
  ];
  const initial = await readDiagnostics(page);
  const animation = initial.player.animation;
  const available = [...animation.availableClips].sort();

  if (
    animation.loadState !== "ready" ||
    animation.activeState !== "idle" ||
    animation.activeClip !== "Idle_8" ||
    !animation.modelSource.endsWith("/assets/models/characters/zeus/zeus.glb") ||
    !(animation.modelScale > 0) ||
    animation.materials.count < 1 ||
    animation.materials.transparentCount !== 0 ||
    animation.materials.depthWriteCount !== animation.materials.count ||
    animation.materials.fullyOpaqueCount !== animation.materials.count ||
    JSON.stringify(available) !== JSON.stringify([...expectedClips].sort())
  ) {
    throw new Error(`${viewport.name} animated Zeus model did not initialize correctly: ${JSON.stringify(animation)}`);
  }

  await page.evaluate(() => window.__ZEUS_GAME__?.defeatPlayerForVerification());
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().player.animation.activeClip === "Dead");
  const defeated = await readDiagnostics(page);
  if (!defeated.gameOver || defeated.player.animation.activeState !== "dead" || !defeated.player.animation.defeated) {
    throw new Error(`${viewport.name} defeat did not start the Dead animation: ${JSON.stringify(defeated.player.animation)}`);
  }

  await page.keyboard.press("KeyR");
  await page.waitForFunction(() => {
    const diagnostics = window.__ZEUS_GAME__?.getDiagnostics();
    return diagnostics && !diagnostics.gameOver && diagnostics.player.animation.activeClip === "Idle_8";
  });
  const restarted = await readDiagnostics(page);
  if (restarted.player.animation.activeState !== "idle" || restarted.player.animation.defeated) {
    throw new Error(`${viewport.name} restart did not restore Idle_8: ${JSON.stringify(restarted.player.animation)}`);
  }
}

async function verifyEnemyAnimationLifecycle(page, viewport) {
  await page.waitForFunction(() => {
    const animation = window.__ZEUS_GAME__?.getDiagnostics().enemyAnimations;
    return animation && animation.total > 0 && animation.loading === 0;
  });

  const expectedClips = ["Running", "Stylish_Walk_inplace", "Walking_Woman", "Walking"];
  const initial = await readDiagnostics(page);
  const animation = initial.enemyAnimations;
  const available = [...animation.availableClips].sort();
  if (
    animation.errors !== 0 ||
    animation.ready !== animation.total ||
    animation.walking !== animation.ready ||
    !animation.activeClips.includes("Walking_Woman") ||
    !animation.modelSource.endsWith("/assets/models/enemies/melee-enemy/melee-enemy.glb") ||
    !(animation.modelScale > 0) ||
    JSON.stringify(available) !== JSON.stringify([...expectedClips].sort())
  ) {
    throw new Error(`${viewport.name} animated melee enemies did not initialize correctly: ${JSON.stringify(animation)}`);
  }

  const triggered = await page.evaluate(() => window.__ZEUS_GAME__?.triggerEnemyAttackForVerification());
  if (!triggered) {
    throw new Error(`${viewport.name} could not trigger a melee enemy attack for verification`);
  }

  await page.waitForFunction(
    (previousCount) => {
      const current = window.__ZEUS_GAME__?.getDiagnostics().enemyAnimations;
      return current && current.attackCount > previousCount && current.attacking > 0;
    },
    animation.attackCount,
  );
  const attacking = (await readDiagnostics(page)).enemyAnimations;
  if (!attacking.activeClips.includes("Stylish_Walk_inplace")) {
    throw new Error(`${viewport.name} melee enemy did not use Stylish_Walk_inplace: ${JSON.stringify(attacking)}`);
  }

  await page.waitForFunction(() => {
    const current = window.__ZEUS_GAME__?.getDiagnostics().enemyAnimations;
    return current && current.attacking === 0 && current.walking === current.ready;
  });
  const resumed = (await readDiagnostics(page)).enemyAnimations;
  if (!resumed.activeClips.includes("Walking_Woman")) {
    throw new Error(`${viewport.name} melee enemy did not return to Walking_Woman: ${JSON.stringify(resumed)}`);
  }
}

async function verifyPotatoRendering(page, viewport) {
  const normal = await readDiagnostics(page);
  if (
    normal.rendering.mode !== "normal" ||
    !normal.rendering.shadowsEnabled ||
    normal.terrain.instancing.terrainInstances < 900 ||
    normal.terrain.instancing.materialMode !== "normal" ||
    normal.terrain.instancing.batches > 20 ||
    normal.rendering.calls > 250 ||
    normal.player.animation.activeVisual !== "animated-model"
  ) {
    throw new Error(`${viewport.name} normal rendering baseline was not instanced: ${JSON.stringify({
      rendering: normal.rendering,
      terrain: normal.terrain.instancing,
      player: normal.player.animation,
    })}`);
  }

  await page.click('[data-ui-action="pause"]');
  await page.waitForSelector('[data-window-id="pause-menu"]:not([hidden])');
  await page.click("[data-potato-mode-toggle]");
  await page.waitForFunction(() => {
    const diagnostics = window.__ZEUS_GAME__?.getDiagnostics();
    return (
      diagnostics?.rendering.mode === "potato" &&
      diagnostics.rendering.pixelRatio === 0.5 &&
      !diagnostics.rendering.shadowsEnabled &&
      diagnostics.player.animation.activeVisual === "primitive" &&
      diagnostics.enemyAnimations.primitiveVisuals === diagnostics.enemyAnimations.total
    );
  });
  await page.waitForTimeout(240);

  const potato = await readDiagnostics(page);
  if (
    potato.rendering.renderedFrames - normal.rendering.renderedFrames < 3 ||
    potato.terrain.instancing.terrainInstances < 900 ||
    potato.terrain.instancing.materialMode !== "potato" ||
    potato.terrain.instancing.batches > 20 ||
    potato.enemyAnimations.lowDetail !== potato.enemyAnimations.total ||
    potato.input.renderMode !== "potato"
  ) {
    throw new Error(`${viewport.name} potato rendering profile was incomplete: ${JSON.stringify({
      rendering: potato.rendering,
      terrain: potato.terrain.instancing,
      player: potato.player.animation,
      enemies: potato.enemyAnimations,
    })}`);
  }

  const storedMode = await page.evaluate(() => JSON.parse(window.localStorage.getItem("zeus.settings.v1") ?? "{}").renderMode);
  if (storedMode !== "potato") {
    throw new Error(`${viewport.name} potato rendering mode was not persisted`);
  }

  await page.click("[data-potato-mode-toggle]");
  await page.waitForFunction(() => {
    const diagnostics = window.__ZEUS_GAME__?.getDiagnostics();
    return (
      diagnostics?.rendering.mode === "normal" &&
      diagnostics.rendering.shadowsEnabled &&
      diagnostics.player.animation.activeVisual === "animated-model" &&
      diagnostics.enemyAnimations.animatedVisuals === diagnostics.enemyAnimations.total
    );
  });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__ZEUS_GAME__?.getDiagnostics().paused === false);
}

async function verifyAbilityCooldownUi(page, viewport, spellId) {
  await page.waitForFunction((id) => {
    const button = document.querySelector(`[data-ability="${id}"]`);
    const fill = button?.querySelector(".ability__cooldown-fill");
    const hand = button?.querySelector(".ability__cooldown-hand");
    if (!(button instanceof HTMLElement) || !(fill instanceof HTMLElement) || !(hand instanceof HTMLElement)) {
      return false;
    }

    return (
      button.classList.contains("ability--cooling") &&
      Number(getComputedStyle(fill).opacity) > 0.7 &&
      Number(getComputedStyle(hand).opacity) > 0.7
    );
  }, spellId);

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
    const hand = button.querySelector(".ability__cooldown-hand");
    const handStyle = hand instanceof HTMLElement ? getComputedStyle(hand) : null;
    const handLineStyle = hand instanceof HTMLElement ? getComputedStyle(hand, "::before") : null;
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
      cooldownHandOffset: style.getPropertyValue("--cooldown-hand-offset").trim(),
      cooldownStartAngle: style.getPropertyValue("--cooldown-start-angle").trim(),
      fillBackground: fill instanceof HTMLElement ? getComputedStyle(fill).backgroundImage : "",
      fillOpacity: fill instanceof HTMLElement ? Number(getComputedStyle(fill).opacity) : 0,
      handOpacity: handStyle ? Number(handStyle.opacity) : 0,
      handTransform: handStyle?.transform ?? "",
      handLineBackground: handLineStyle?.backgroundImage ?? "",
      handLineBoxShadow: handLineStyle?.boxShadow ?? "",
      handLineHeight: handLineStyle?.height ?? "",
      handLineWidth: handLineStyle?.width ?? "",
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
  if (metrics.cooldownStartAngle !== "0deg" || metrics.cooldownHandOffset !== "0deg") {
    throw new Error(`${viewport.name} ${spellId} ability cooldown fill/hand did not start at 12 o'clock: ${JSON.stringify(metrics)}`);
  }
  if (
    metrics.fillOpacity < 0.7 ||
    metrics.handOpacity < 0.7 ||
    metrics.handTransform === "none" ||
    metrics.handLineBackground === "none" ||
    metrics.handLineBoxShadow === "none" ||
    Number.parseFloat(metrics.handLineHeight) < 20 ||
    Number.parseFloat(metrics.handLineWidth) < 2
  ) {
    throw new Error(`${viewport.name} ${spellId} ability cooldown visual was too subtle or missing leading hand: ${JSON.stringify(metrics)}`);
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
  await waitForPlayerModel(page, { name: "reloaded game" });
}

async function waitForPlayerModel(page, viewport) {
  await page.waitForFunction(() => {
    const diagnostics = window.__ZEUS_GAME__?.getDiagnostics();
    const loadState = diagnostics?.player.animation.loadState;
    return diagnostics?.input.renderMode === "potato" || loadState === "ready" || loadState === "error";
  });
  const diagnostics = await readDiagnostics(page);
  if (diagnostics.input.renderMode === "potato" && diagnostics.player.animation.activeVisual === "primitive") {
    return;
  }
  if (diagnostics.player.animation.loadState !== "ready") {
    throw new Error(`${viewport.name} animated Zeus model failed to load: ${JSON.stringify(diagnostics.player.animation)}`);
  }
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

function angleDistance(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function assertContinuousVisibilityOverlay(viewport, diagnostics, label) {
  const overlay = diagnostics.visibilityOverlay;
  if (!overlay || !(overlay.texelWorldSize > 0) || !overlay.centerWorld) {
    throw new Error(`${viewport.name} missing continuous visibility overlay diagnostics (${label}): ${JSON.stringify(overlay)}`);
  }

  const centerDistance = Math.hypot(
    overlay.centerWorld.x - diagnostics.player.position[0],
    overlay.centerWorld.z - diagnostics.player.position[2],
  );
  if (centerDistance > Math.max(0.25, overlay.texelWorldSize)) {
    throw new Error(
      `${viewport.name} visibility overlay center did not follow player (${label}): distance=${centerDistance}, overlay=${JSON.stringify(overlay.centerWorld)}, player=${JSON.stringify(diagnostics.player.position)}`,
    );
  }

  if (overlay.alphaHistoryAction !== "smooth") {
    throw new Error(`${viewport.name} visibility overlay reported invalid alpha history action (${label}): ${JSON.stringify(overlay)}`);
  }
}

function cameraLowerFrustumOriginY(camera) {
  const [qx, qy, qz, qw] = camera.quaternion;
  const upY = 1 - 2 * (qx * qx + qz * qz);
  return camera.position[1] + upY * camera.projection.bottom;
}

async function collectHudMetrics(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const abilities = [...document.querySelectorAll(".ability")].map((element) => element.textContent?.trim() ?? "");
    const statusVisible = getComputedStyle(document.querySelector(".ui-layer") ?? document.body).display !== "none";
    return {
      hasKills: text.includes("Kills"),
      hasWave: text.includes("Wave"),
      hasCell: text.includes("Hex"),
      hasChain: abilities.some((text) => text.includes("Q") && text.includes("Chain")),
      hasBolt: abilities.some((text) => text.includes("W") && text.includes("Bolt")),
      hasCursedEnergy: text.includes("Cursed Energy"),
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
      status: readPanel("hud-status"),
      game: readPanel("hud-position"),
      abilities: readPanel("hud-abilities"),
      currencies: readPanel("hud-currencies"),
    };
  });
}

function assertPageResult(result) {
  const { viewport, hud, errors } = result;
  const hudOk = hud.hasKills && hud.hasWave && hud.hasCell && hud.hasChain && hud.hasBolt && hud.hasCursedEnergy && hud.statusVisible;

  if (!hudOk) {
    throw new Error(`${viewport.name} HUD check failed: ${JSON.stringify(hud)}`);
  }
  if (errors.length > 0) {
    throw new Error(`${viewport.name} browser errors: ${errors.join(" | ")}`);
  }
}

async function startDevServer() {
  const viteCli = path.join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
  const server = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", port, "--strictPort", "--force"], {
    cwd: process.cwd(),
    env: { ...process.env, VITE_BASE_PATH: process.env.VITE_BASE_PATH ?? basePath },
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

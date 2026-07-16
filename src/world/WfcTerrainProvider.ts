import { ROLLING_TERRAIN_PATCH_RADIUS } from "../config";
import type { TerrainCell, TerrainStructure, TerrainSurface } from "../types";
import {
  HEX_PATCH_RADIUS,
  createHexPatchRegion,
  createHexPatchTileCatalog,
  microToPatchLocal,
  patchLocalToWorld,
  type HexPatchTileVariant,
} from "./HexTerrainCatalog";
import {
  createTerrainStructureCounts,
  createTerrainSurfaceCounts,
  decorateSpecialTerrainSurface,
  findPatchSocketMismatch,
  patchVariantsCanNeighbor,
  type HexPatchSocketMismatch,
} from "./HexTerrainRules";
import { hexCellKey, hexDistance, type HexCoord } from "./hexCoordinates";
import { createTerrainCell, type TerrainProvider } from "./TerrainProvider";
import {
  serializeBoundaryConstraints,
  synthesizeProceduralPatch,
} from "./ProceduralTerrainPatch";
import { collectPatchBoundaryConstraints, selectAuthoredPatchVariant } from "./RollingTerrainPatchSelection";
import { evaluateMovementEnclosures } from "./TerrainEnclosurePolicy";
import { createMovementTopologyContext } from "./TerrainTopologyContext";

type CommittedPatch = HexCoord & {
  variant: HexPatchTileVariant;
  emergency: boolean;
};

type RollingWfcDiagnostics = {
  enabled: true;
  mode: "rolling-patch";
  patchRadius: number;
  activePatchRadius: number;
  seed: number;
  patchVariantCount: number;
  committedPatchCount: number;
  generatedPatchCount: number;
  generatedLastEnsure: number;
  emergencyPatchCount: number;
  contradictionCount: number;
  authoredPatchCount: number;
  proceduralPatchCount: number;
  proceduralPatchCacheSize: number;
  synthesisAttemptCount: number;
  synthesisFailureCount: number;
  synthesisAssignmentCount: number;
  synthesisDurationMs: number;
  proceduralFillModeCounts: Record<string, number>;
  proceduralBoundarySignatureCounts: Record<string, number>;
  topologySelectionCounts: Record<string, number>;
  shortLoopCandidatesSuppressed: Record<"wall" | "river", number>;
  forcedShortLoopSelectionCount: number;
  selectedShortLoopLengthCounts: Record<string, number>;
  enclosureCandidatesRejected: number;
  proceduralTopologyRejectionCount: number;
  proceduralTerminationPatchCount: number;
  enclosureViolationSample: { q: number; r: number; cellCount: number } | null;
  generationEnsureCount: number;
  generationLastDurationMs: number;
  generationTotalDurationMs: number;
  generationMaxDurationMs: number;
  topologyEvaluationCount: number;
  authoredSelectionDurationMs: number;
  generationPatchBudget: number | null;
  patchGenerationLastDurationMs: number;
  patchGenerationTotalDurationMs: number;
  patchGenerationMaxDurationMs: number;
  resolvedPatchCount: number;
  resolvedCells: number;
  structureCounts: Record<TerrainStructure, number>;
  surfaceCounts: Record<TerrainSurface, number>;
  patchVariantCounts: Record<string, number>;
  patchSocketMismatchSample: HexPatchSocketMismatch | null;
  fellBack: false;
};

export const WFC_TERRAIN_SEED = 20260517;
const SAFE_START_PATCH_RADIUS = 1;

export class WfcTerrainProvider implements TerrainProvider {
  private readonly variants = createHexPatchTileCatalog();
  private readonly openVariant = this.variants.find((variant) => variant.id === "patch.open.grass") ?? this.variants[0];
  private readonly committedPatches = new Map<string, CommittedPatch>();
  private readonly generatedCells = new Map<string, TerrainCell>();
  private readonly structureCounts = createTerrainStructureCounts();
  private readonly surfaceCounts = createTerrainSurfaceCounts();
  private readonly patchVariantCounts: Record<string, number> = {};
  private readonly proceduralPatchCache = new Map<string, HexPatchTileVariant[]>();
  private readonly topologyContext = createMovementTopologyContext([]);
  private readonly proceduralFillModeCounts: Record<string, number> = {};
  private readonly proceduralBoundarySignatureCounts: Record<string, number> = {};
  private readonly topologySelectionCounts: Record<string, number> = {};
  private readonly shortLoopCandidatesSuppressed = { wall: 0, river: 0 };
  private readonly selectedShortLoopLengthCounts: Record<string, number> = {};
  private generatedPatchCount = 0;
  private generatedLastEnsure = 0;
  private emergencyPatchCount = 0;
  private contradictionCount = 0;
  private authoredPatchCount = 0;
  private proceduralPatchCount = 0;
  private synthesisAttemptCount = 0;
  private synthesisFailureCount = 0;
  private synthesisAssignmentCount = 0;
  private synthesisDurationMs = 0;
  private forcedShortLoopSelectionCount = 0;
  private enclosureCandidatesRejected = 0;
  private proceduralTopologyRejectionCount = 0;
  private proceduralTerminationPatchCount = 0;
  private generationEnsureCount = 0;
  private generationLastDurationMs = 0;
  private generationTotalDurationMs = 0;
  private generationMaxDurationMs = 0;
  private authoredSelectionDurationMs = 0;
  private generationLastBudget = Number.POSITIVE_INFINITY;
  private patchGenerationLastDurationMs = 0;
  private patchGenerationTotalDurationMs = 0;
  private patchGenerationMaxDurationMs = 0;

  constructor(private readonly seed = WFC_TERRAIN_SEED) {
    this.ensureGeneratedAround(0, 0);
  }

  getCell(q: number, r: number): TerrainCell {
    const key = hexCellKey(q, r);
    const existing = this.generatedCells.get(key);
    if (existing) {
      return existing;
    }

    const address = microToPatchLocal({ q, r });
    this.commitPatchIfMissing(address.patch);
    return this.generatedCells.get(key) ?? createTerrainCell(q, r, "open", "grass");
  }

  getGeneratedCell(q: number, r: number) {
    return this.generatedCells.get(hexCellKey(q, r)) ?? null;
  }

  getGeneratedCellsInRange(center: HexCoord, radius: number) {
    const cells: TerrainCell[] = [];
    for (const cell of this.generatedCells.values()) {
      if (hexDistance(center, cell) <= radius) {
        cells.push(cell);
      }
    }
    return cells;
  }

  getGenerationVersion() {
    return this.generatedPatchCount;
  }

  ensureGeneratedAround(
    q: number,
    r: number,
    radius = ROLLING_TERRAIN_PATCH_RADIUS,
    maxNewPatches = Number.POSITIVE_INFINITY,
  ) {
    const startedAt = performance.now();
    this.generationLastBudget = maxNewPatches;
    const center = microToPatchLocal({ q, r }).patch;
    const required = createHexPatchRegion(radius)
      .map((patch) => ({ q: center.q + patch.q, r: center.r + patch.r }))
      .sort((a, b) => hexDistance(center, a) - hexDistance(center, b) || a.q - b.q || a.r - b.r);

    let generated = 0;
    for (const patch of required) {
      if (generated >= maxNewPatches) {
        break;
      }
      if (this.commitPatchIfMissing(patch)) {
        generated += 1;
      }
    }
    this.generatedLastEnsure = generated;
    const duration = performance.now() - startedAt;
    this.generationEnsureCount += 1;
    this.generationLastDurationMs = duration;
    this.generationTotalDurationMs += duration;
    this.generationMaxDurationMs = Math.max(this.generationMaxDurationMs, duration);
  }

  getDiagnostics() {
    const enclosureAudit = evaluateMovementEnclosures(this.committedPatches.values());
    const wfc: RollingWfcDiagnostics = {
      enabled: true,
      mode: "rolling-patch",
      patchRadius: HEX_PATCH_RADIUS,
      activePatchRadius: ROLLING_TERRAIN_PATCH_RADIUS,
      seed: this.seed,
      patchVariantCount: this.variants.length,
      committedPatchCount: this.committedPatches.size,
      generatedPatchCount: this.generatedPatchCount,
      generatedLastEnsure: this.generatedLastEnsure,
      emergencyPatchCount: this.emergencyPatchCount,
      contradictionCount: this.contradictionCount,
      authoredPatchCount: this.authoredPatchCount,
      proceduralPatchCount: this.proceduralPatchCount,
      proceduralPatchCacheSize: [...this.proceduralPatchCache.values()].reduce((sum, variants) => sum + variants.length, 0),
      synthesisAttemptCount: this.synthesisAttemptCount,
      synthesisFailureCount: this.synthesisFailureCount,
      synthesisAssignmentCount: this.synthesisAssignmentCount,
      synthesisDurationMs: this.synthesisDurationMs,
      proceduralFillModeCounts: { ...this.proceduralFillModeCounts },
      proceduralBoundarySignatureCounts: { ...this.proceduralBoundarySignatureCounts },
      topologySelectionCounts: { ...this.topologySelectionCounts },
      shortLoopCandidatesSuppressed: { ...this.shortLoopCandidatesSuppressed },
      forcedShortLoopSelectionCount: this.forcedShortLoopSelectionCount,
      selectedShortLoopLengthCounts: { ...this.selectedShortLoopLengthCounts },
      enclosureCandidatesRejected: this.enclosureCandidatesRejected,
      proceduralTopologyRejectionCount: this.proceduralTopologyRejectionCount,
      proceduralTerminationPatchCount: this.proceduralTerminationPatchCount,
      enclosureViolationSample: enclosureAudit.safe
        ? null
        : { ...enclosureAudit.enclosure.sample, cellCount: enclosureAudit.enclosure.cellCount },
      generationEnsureCount: this.generationEnsureCount,
      generationLastDurationMs: this.generationLastDurationMs,
      generationTotalDurationMs: this.generationTotalDurationMs,
      generationMaxDurationMs: this.generationMaxDurationMs,
      topologyEvaluationCount: this.topologyContext.evaluationCount,
      authoredSelectionDurationMs: this.authoredSelectionDurationMs,
      generationPatchBudget: Number.isFinite(this.generationLastBudget)
        ? this.generationLastBudget
        : null,
      patchGenerationLastDurationMs: this.patchGenerationLastDurationMs,
      patchGenerationTotalDurationMs: this.patchGenerationTotalDurationMs,
      patchGenerationMaxDurationMs: this.patchGenerationMaxDurationMs,
      resolvedPatchCount: this.committedPatches.size,
      resolvedCells: this.generatedCells.size,
      structureCounts: { ...this.structureCounts },
      surfaceCounts: { ...this.surfaceCounts },
      patchVariantCounts: { ...this.patchVariantCounts },
      patchSocketMismatchSample: findPatchSocketMismatch(this.committedPatches.values()),
      fellBack: false,
    };

    return { wfc };
  }

  private commitPatchIfMissing(patch: HexCoord) {
    const key = hexCellKey(patch.q, patch.r);
    if (this.committedPatches.has(key)) {
      return false;
    }

    const startedAt = performance.now();
    const { variant, emergency } = this.choosePatchVariant(patch);
    const committed = { ...patch, variant, emergency };
    this.topologyContext.commitVariant(patch, variant);
    this.committedPatches.set(key, committed);
    this.patchVariantCounts[variant.id] = (this.patchVariantCounts[variant.id] ?? 0) + 1;
    this.topologySelectionCounts[variant.topology] = (this.topologySelectionCounts[variant.topology] ?? 0) + 1;
    if (variant.provenance === "procedural") {
      this.proceduralPatchCount += 1;
      const fillMode = variant.procedural?.fillMode ?? "unknown";
      const boundaryKey = variant.procedural?.boundaryKey ?? "unknown";
      this.proceduralFillModeCounts[fillMode] = (this.proceduralFillModeCounts[fillMode] ?? 0) + 1;
      this.proceduralBoundarySignatureCounts[boundaryKey] = (this.proceduralBoundarySignatureCounts[boundaryKey] ?? 0) + 1;
    } else {
      this.authoredPatchCount += 1;
    }
    this.generatedPatchCount += 1;
    if (emergency) {
      this.emergencyPatchCount += 1;
    }

    this.expandPatch(committed);
    const duration = performance.now() - startedAt;
    this.patchGenerationLastDurationMs = duration;
    this.patchGenerationTotalDurationMs += duration;
    this.patchGenerationMaxDurationMs = Math.max(this.patchGenerationMaxDurationMs, duration);
    return true;
  }

  private choosePatchVariant(patch: HexCoord) {
    const selectionStartedAt = performance.now();
    const authoredResult = selectAuthoredPatchVariant({
      patch,
      variants: this.variants,
      committedPatches: this.committedPatches,
      seed: this.seed,
      safeStartRadius: SAFE_START_PATCH_RADIUS,
      requireFirstRiver: this.structureCounts.river === 0,
      topologyContext: this.topologyContext,
    });
    this.authoredSelectionDurationMs += performance.now() - selectionStartedAt;
    this.enclosureCandidatesRejected += authoredResult.enclosureCandidatesRejected;
    const authoredSelection = authoredResult.selection;
    if (!authoredSelection) {
      const constraints = collectPatchBoundaryConstraints(patch, this.committedPatches);
      const boundaryKey = serializeBoundaryConstraints(constraints);
      const cached = this.proceduralPatchCache.get(boundaryKey)?.find((variant) =>
        this.topologyContext.evaluateVariant(patch, variant).safe,
      );
      if (cached) {
        if (authoredResult.enclosureCandidatesRejected > 0) {
          this.proceduralTerminationPatchCount += 1;
        }
        return { variant: cached, emergency: false };
      }

      this.synthesisAttemptCount += 1;
      const startedAt = performance.now();
      let topologyRejections = 0;
      const result = synthesizeProceduralPatch(constraints, this.seed, {
        preferFastTermination: true,
        acceptsCells: (cells) => {
          const safe = this.topologyContext.evaluateCells(patch, cells).safe;
          if (!safe) {
            topologyRejections += 1;
          }
          return safe;
        },
      });
      this.synthesisAssignmentCount += result.attemptedAssignments;
      this.proceduralTopologyRejectionCount += topologyRejections;
      this.synthesisDurationMs += performance.now() - startedAt;
      if (result.ok) {
        const cachedVariants = this.proceduralPatchCache.get(boundaryKey) ?? [];
        if (!cachedVariants.some((variant) => variant.id === result.variant.id)) {
          cachedVariants.push(result.variant);
          this.proceduralPatchCache.set(boundaryKey, cachedVariants);
        }
        if (authoredResult.enclosureCandidatesRejected > 0) {
          this.proceduralTerminationPatchCount += 1;
        }
        return { variant: result.variant, emergency: false };
      }

      this.synthesisFailureCount += 1;
      this.contradictionCount += 1;
      return { variant: this.openVariant, emergency: true };
    }

    this.shortLoopCandidatesSuppressed.wall += authoredSelection.loopPolicy.suppressedCandidates.wall;
    this.shortLoopCandidatesSuppressed.river += authoredSelection.loopPolicy.suppressedCandidates.river;
    if (authoredSelection.loopPolicy.forced) {
      this.forcedShortLoopSelectionCount += 1;
    }
    for (const loop of authoredSelection.loopPolicy.selectedLoops) {
      const key = `${loop.feature}:${loop.kind}:${loop.length}`;
      this.selectedShortLoopLengthCounts[key] = (this.selectedShortLoopLengthCounts[key] ?? 0) + 1;
    }
    return { variant: authoredSelection.variant, emergency: false };
  }

  private expandPatch(patch: CommittedPatch) {
    for (const localCell of patch.variant.cells.values()) {
      const world = patchLocalToWorld(patch, localCell);
      const key = hexCellKey(world.q, world.r);
      if (this.generatedCells.has(key)) {
        continue;
      }

      const surface = decorateSpecialTerrainSurface(
        localCell.structure,
        localCell.surface,
        world.q,
        world.r,
        this.seed,
      );
      const cell = createTerrainCell(world.q, world.r, localCell.structure, surface, localCell.edges);
      this.generatedCells.set(key, cell);
      this.structureCounts[cell.structure] += 1;
      this.surfaceCounts[cell.surface] += 1;
    }
  }
}

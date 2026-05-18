import { ROLLING_TERRAIN_PATCH_RADIUS } from "../config";
import type { TerrainCell, TerrainStructure } from "../types";
import {
  HEX_PATCH_RADIUS,
  createHexPatchRegion,
  createHexPatchTileCatalog,
  microToPatchLocal,
  patchLocalToWorld,
  type HexPatchTileVariant,
} from "./HexTerrainCatalog";
import { createTerrainStructureCounts, findPatchSocketMismatch, patchVariantsCanNeighbor, type HexPatchSocketMismatch } from "./HexTerrainRules";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, hexCellKey, hexDistance, type HexCoord } from "./hexCoordinates";
import { createTerrainCell, type TerrainProvider } from "./TerrainProvider";

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
  resolvedPatchCount: number;
  resolvedCells: number;
  structureCounts: Record<TerrainStructure, number>;
  patchVariantCounts: Record<string, number>;
  patchSocketMismatchSample: HexPatchSocketMismatch | null;
  fellBack: false;
};

const WFC_TERRAIN_SEED = 20260517;
const SAFE_START_PATCH_RADIUS = 1;

export class WfcTerrainProvider implements TerrainProvider {
  private readonly variants = createHexPatchTileCatalog();
  private readonly openVariant = this.variants.find((variant) => variant.id === "patch.open.grass") ?? this.variants[0];
  private readonly committedPatches = new Map<string, CommittedPatch>();
  private readonly generatedCells = new Map<string, TerrainCell>();
  private readonly structureCounts = createTerrainStructureCounts();
  private readonly patchVariantCounts: Record<string, number> = {};
  private generatedPatchCount = 0;
  private generatedLastEnsure = 0;
  private emergencyPatchCount = 0;
  private contradictionCount = 0;

  constructor(private readonly worldRadius: number) {
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

  ensureGeneratedAround(q: number, r: number, radius = ROLLING_TERRAIN_PATCH_RADIUS) {
    const center = microToPatchLocal({ q, r }).patch;
    const required = createHexPatchRegion(radius)
      .map((patch) => ({ q: center.q + patch.q, r: center.r + patch.r }))
      .sort((a, b) => hexDistance(center, a) - hexDistance(center, b) || a.q - b.q || a.r - b.r);

    let generated = 0;
    for (const patch of required) {
      if (this.commitPatchIfMissing(patch)) {
        generated += 1;
      }
    }
    this.generatedLastEnsure = generated;
  }

  getDiagnostics() {
    const wfc: RollingWfcDiagnostics = {
      enabled: true,
      mode: "rolling-patch",
      patchRadius: HEX_PATCH_RADIUS,
      activePatchRadius: ROLLING_TERRAIN_PATCH_RADIUS,
      seed: WFC_TERRAIN_SEED,
      patchVariantCount: this.variants.length,
      committedPatchCount: this.committedPatches.size,
      generatedPatchCount: this.generatedPatchCount,
      generatedLastEnsure: this.generatedLastEnsure,
      emergencyPatchCount: this.emergencyPatchCount,
      contradictionCount: this.contradictionCount,
      resolvedPatchCount: this.committedPatches.size,
      resolvedCells: this.generatedCells.size,
      structureCounts: { ...this.structureCounts },
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

    const { variant, emergency } = this.choosePatchVariant(patch);
    const committed = { ...patch, variant, emergency };
    this.committedPatches.set(key, committed);
    this.patchVariantCounts[variant.id] = (this.patchVariantCounts[variant.id] ?? 0) + 1;
    this.generatedPatchCount += 1;
    if (emergency) {
      this.emergencyPatchCount += 1;
    }

    this.expandPatch(committed);
    return true;
  }

  private choosePatchVariant(patch: HexCoord) {
    const compatible = this.variants.filter((variant) => this.matchesCommittedNeighbors(patch, variant));
    const frontierSafe = compatible.filter((variant) => this.keepsNeighborDomainsOpen(patch, variant));
    const baseCandidates = frontierSafe.length > 0 ? frontierSafe : compatible;
    const safeStart = hexDistance(patch, { q: 0, r: 0 }) <= SAFE_START_PATCH_RADIUS;
    const safeCandidates = safeStart ? baseCandidates.filter((variant) => variant.diagnostics.kind === "open") : [];
    const riverCandidates =
      !safeStart && this.structureCounts.river === 0
        ? baseCandidates.filter((variant) => variant.diagnostics.kind === "river")
        : [];
    const candidates = safeCandidates.length > 0 ? safeCandidates : riverCandidates.length > 0 ? riverCandidates : baseCandidates;

    if (candidates.length === 0) {
      this.contradictionCount += 1;
      return { variant: this.openVariant, emergency: true };
    }

    return { variant: this.chooseWeightedVariant(patch, candidates), emergency: false };
  }

  private matchesCommittedNeighbors(patch: HexCoord, variant: HexPatchTileVariant) {
    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      const neighbor = this.committedPatches.get(hexCellKey(patch.q + offset.q, patch.r + offset.r));
      if (neighbor && !patchVariantsCanNeighbor(variant, direction, neighbor.variant)) {
        return false;
      }
    }

    return true;
  }

  private keepsNeighborDomainsOpen(patch: HexCoord, variant: HexPatchTileVariant) {
    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      const neighborPatch = { q: patch.q + offset.q, r: patch.r + offset.r };
      if (this.committedPatches.has(hexCellKey(neighborPatch.q, neighborPatch.r))) {
        continue;
      }

      const neighborHasCandidate = this.variants.some((neighborVariant) =>
        this.matchesNeighborsWithHypothetical(neighborPatch, neighborVariant, patch, variant),
      );
      if (!neighborHasCandidate) {
        return false;
      }
    }

    return true;
  }

  private matchesNeighborsWithHypothetical(
    patch: HexCoord,
    variant: HexPatchTileVariant,
    hypotheticalPatch: HexCoord,
    hypotheticalVariant: HexPatchTileVariant,
  ) {
    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      const neighborCoord = { q: patch.q + offset.q, r: patch.r + offset.r };
      const neighborVariant =
        neighborCoord.q === hypotheticalPatch.q && neighborCoord.r === hypotheticalPatch.r
          ? hypotheticalVariant
          : this.committedPatches.get(hexCellKey(neighborCoord.q, neighborCoord.r))?.variant;

      if (neighborVariant && !patchVariantsCanNeighbor(variant, direction, neighborVariant)) {
        return false;
      }
    }

    return true;
  }

  private chooseWeightedVariant(patch: HexCoord, candidates: readonly HexPatchTileVariant[]) {
    const totalWeight = candidates.reduce((sum, variant) => sum + variant.weight, 0);
    let roll = seededUnit(WFC_TERRAIN_SEED, patch.q, patch.r) * totalWeight;

    for (const variant of candidates) {
      roll -= variant.weight;
      if (roll <= 0) {
        return variant;
      }
    }

    return candidates[candidates.length - 1];
  }

  private expandPatch(patch: CommittedPatch) {
    for (const localCell of patch.variant.cells.values()) {
      const world = patchLocalToWorld(patch, localCell);
      if (!this.isInWorldBounds(world.q, world.r)) {
        continue;
      }

      const key = hexCellKey(world.q, world.r);
      if (this.generatedCells.has(key)) {
        continue;
      }

      const cell = createTerrainCell(world.q, world.r, localCell.structure, localCell.surface, localCell.edges);
      this.generatedCells.set(key, cell);
      this.structureCounts[cell.structure] += 1;
    }
  }

  private isInWorldBounds(q: number, r: number) {
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= this.worldRadius;
  }
}

function seededUnit(seed: number, q: number, r: number) {
  let value = seed >>> 0;
  value ^= Math.imul(q, 0x9e3779b1);
  value ^= Math.imul(r, 0x85ebca77);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

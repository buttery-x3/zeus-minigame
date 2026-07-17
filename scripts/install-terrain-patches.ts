import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHexPatchCatalogEntries } from "../src/world/HexTerrainCatalog.ts";
import { parseTerrainPatchPack } from "../src/world/TerrainPatchPack.ts";
import { validateTerrainPatchDocument } from "../src/world/TerrainPatchDocument.ts";

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const sourceArg = args.find((argument) => !argument.startsWith("--"));
if (!sourceArg) throw new Error("Usage: npm run terrain:patches:install -- <patch-pack.json> [--replace]");

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(process.cwd(), sourceArg);
const targetPath = path.join(repositoryRoot, "src", "world", "authored-patches", "custom-patches.json");
const [incomingRaw, existingRaw] = await Promise.all([readFile(sourcePath, "utf8"), readFile(targetPath, "utf8")]);
const incoming = parseTerrainPatchPack(JSON.parse(incomingRaw));
const existing = parseTerrainPatchPack(JSON.parse(existingRaw));
const existingCustomIds = new Set(existing.patches.map((patch) => patch.id));
const builtInIds = new Set(createHexPatchCatalogEntries().map((entry) => entry.definition.id).filter((id) => !existingCustomIds.has(id)));

for (const patch of incoming.patches) {
  const validation = validateTerrainPatchDocument(patch);
  if (!validation.valid) throw new Error(`${patch.id} is invalid: ${validation.errors.join("; ")}`);
  if (builtInIds.has(patch.id)) throw new Error(`${patch.id} is a built-in definition and cannot be replaced by the custom pack`);
  if (existingCustomIds.has(patch.id) && !replace) throw new Error(`${patch.id} already exists; pass --replace to update it`);
}

const merged = new Map(existing.patches.map((patch) => [patch.id, patch]));
incoming.patches.forEach((patch) => merged.set(patch.id, patch));
const output = {
  schemaVersion: 1,
  kind: "zeus-terrain-patch-drafts",
  patches: [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)),
} as const;
await writeFile(targetPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Installed ${incoming.patches.length} patch${incoming.patches.length === 1 ? "" : "es"}: ${incoming.patches.map((patch) => patch.id).join(", ")}`);

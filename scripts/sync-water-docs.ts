/**
 * Rewrites the generated blocks in docs/water.md from the canonical water data.
 * Usage: npm run docs:water
 */
import { readFileSync, writeFileSync } from "node:fs";
import { syncWaterDoc } from "../src/domain/water/docs.ts";
import { slumpBaseWater } from "../src/domain/water/slump-water.ts";

const path = new URL("../docs/water.md", import.meta.url);
const before = readFileSync(path, "utf8");
const after = syncWaterDoc(before, slumpBaseWater);
if (after === before) {
  console.log("docs/water.md is up to date.");
} else {
  writeFileSync(path, after);
  console.log(`docs/water.md updated from ${slumpBaseWater.id}.`);
}

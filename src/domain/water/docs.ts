import { saltIonIncrease } from "../brewing-calculations/water-chemistry.ts";
import { ionInfo, ionKeys, waterAgents, waterSourceKindLabels, waterValueBasisLabels, type WaterProfile } from "../model/water.ts";
import { num } from "../format.ts";
import { describeSourceWater } from "./describe.ts";

/**
 * Markdown for the generated blocks in docs/water.md, so the numbers in the documentation come from
 * the canonical data and can never be a second, hand-kept copy. `npm run docs:water` rewrites the
 * blocks; tests/domain/water-docs.test.ts fails when the file is out of date.
 */

export const waterDocBlocks = {
  profile: "water-profile",
  agents: "water-agents",
} as const;

export function renderWaterProfileMarkdown(profile: WaterProfile): string {
  const description = describeSourceWater(profile);
  const lines: string[] = [];
  lines.push(`Profil-id: \`${profile.id}\``, "");
  lines.push("| Verdi | Tall | Enhet | Slag |", "|---|---:|---|---|");
  for (const row of [...description.reported, ...description.calculated]) {
    lines.push(`| ${row.label} | ${num(row.value, row.decimals)} | ${row.unit || "–"} | ${waterValueBasisLabels[row.basis]} |`);
  }
  lines.push("");
  if (description.other.length > 0) {
    lines.push(`Øvrige oppgitte verdier (${description.other.length}), slik kilden skriver dem. Kolonnen «Grenseverdi» er kildens egen grense for drikkevann, ikke et bryggemål:`, "");
    lines.push("| Parameter | Tall | Enhet | Grenseverdi |", "|---|---:|---|---|");
    for (const row of description.other) lines.push(`| ${row.label} | ${num(row.value, row.decimals)} | ${row.unit || "–"} | ${row.limit ?? "–"} |`);
    lines.push("");
    if (description.limits.checked > 0 && description.limits.allBelow) {
      lines.push(`Alle ${description.limits.checked} verdier med tallfestet grenseverdi ligger under den.`, "");
    }
  }
  if (profile.confirmedUse) {
    lines.push(`- **Bekreftet i bruk:** ${profile.confirmedUse.confirmedBy}, ${profile.confirmedUse.confirmedAt}.${profile.confirmedUse.note ? ` ${profile.confirmedUse.note}` : ""}`);
  }
  lines.push(`- **Kilde:** ${waterSourceKindLabels[profile.source.kind]}, ${profile.source.organization}. ${profile.source.title}. <${profile.source.url}>`);
  lines.push(`- **Hentet:** ${profile.source.retrievedAt}`);
  lines.push(`- **Prøve- eller publiseringsdato:** ${profile.source.publishedAt ?? "ikke oppgitt av kilden"}`);
  if (profile.source.lastModifiedAt) lines.push(`- **Siden sist endret (HTTP Last-Modified):** ${profile.source.lastModifiedAt}. Dette daterer siden, ikke analysen.`);
  lines.push("");
  lines.push("Forbehold:", "");
  for (const caveat of profile.caveats) lines.push(`- ${caveat}`);
  return lines.join("\n");
}

export function renderWaterAgentsMarkdown(): string {
  const lines: string[] = [];
  lines.push("| Middel | Id | " + ionKeys.map((key) => ionInfo[key].symbol).join(" | ") + " |", "|---|---|" + ionKeys.map(() => "---:").join("|") + "|");
  for (const agent of waterAgents) {
    if (agent.kind !== "salt") continue;
    const increase = saltIonIncrease(agent.composition, 1, 10);
    lines.push(`| ${agent.label} | \`${agent.id}\` | ${ionKeys.map((key) => (increase[key] === undefined ? "–" : increase[key]!.toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 }))).join(" | ")} |`);
  }
  lines.push("");
  lines.push(
    "Salter: mg/L ion som 1 g gir når det løses i 10 L vann. Syrer: " +
      waterAgents
        .flatMap((agent) => (agent.kind === "acid" ? [`${agent.label.toLowerCase()} (\`${agent.id}\`, vanlige styrker ${agent.typicalStrengthsPct.join(", ")} %)`] : []))
        .join("; ") +
      ".",
  );
  return lines.join("\n");
}

const markers = (name: string) => ({ start: `<!-- ${name}:start -->`, end: `<!-- ${name}:end -->` });

/** Replaces the text between a block's markers; throws when the markers are missing. */
export function replaceDocBlock(document: string, name: string, content: string): string {
  const { start, end } = markers(name);
  const from = document.indexOf(start);
  const to = document.indexOf(end);
  if (from === -1 || to === -1 || to < from) throw new Error(`Markers for ${name} not found`);
  return `${document.slice(0, from + start.length)}\n${content}\n${document.slice(to)}`;
}

export function syncWaterDoc(document: string, profile: WaterProfile): string {
  return replaceDocBlock(replaceDocBlock(document, waterDocBlocks.profile, renderWaterProfileMarkdown(profile)), waterDocBlocks.agents, renderWaterAgentsMarkdown());
}

/**
 * Alcohol by volume from original and final gravity.
 * `standard`: (OG − FG) × 131.25 — what most brewing software shows by default.
 * `alternate`: more accurate at high gravity (Daniels / Papazian variant).
 */
export function calculateAbv(og: number, fg: number, formula: "standard" | "alternate" = "standard"): number {
  if (formula === "alternate") {
    return ((76.08 * (og - fg)) / (1.775 - og)) * (fg / 0.794);
  }
  return (og - fg) * 131.25;
}

/** Apparent attenuation (%). */
export function calculateApparentAttenuation(og: number, fg: number): number {
  if (og <= 1) throw new RangeError("og must be above 1.000");
  return ((og - fg) / (og - 1)) * 100;
}

/** Expected final gravity for a yeast with a given apparent attenuation. */
export function estimateFinalGravity(og: number, attenuationPct: number): number {
  return 1 + (og - 1) * (1 - attenuationPct / 100);
}

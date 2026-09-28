/** Post-boil volume after evaporation. */
export function calculateBoilOff(input: { preBoilVolumeL: number; boilOffLPerH: number; boilTimeMin: number }): {
  postBoilVolumeL: number;
  evaporatedL: number;
} {
  const evaporatedL = input.boilOffLPerH * (input.boilTimeMin / 60);
  return { postBoilVolumeL: Math.max(0, input.preBoilVolumeL - evaporatedL), evaporatedL };
}

/** Measured boil-off rate (L/h) from hot volumes before and after the boil. */
export function calculateBoilOffRate(input: { preBoilVolumeL: number; postBoilVolumeL: number; boilTimeMin: number }): number {
  if (input.boilTimeMin <= 0) throw new RangeError("boilTimeMin must be positive");
  return (input.preBoilVolumeL - input.postBoilVolumeL) / (input.boilTimeMin / 60);
}

export interface WaterVolumeInput {
  /** Target volume into the fermenter(s). */
  batchVolumeL: number;
  grainKg: number;
  boilTimeMin: number;
  boilOffLPerH: number;
  grainAbsorptionLPerKg: number;
  mashThicknessLPerKg: number;
  mashDeadSpaceL?: number;
  pumpPipeLossL?: number;
  kettleLossL?: number;
  chillerLossL?: number;
  transferLossL?: number;
  coolingShrinkagePct?: number;
}

export interface WaterVolumeResult {
  mashWaterL: number;
  spargeWaterL: number;
  totalWaterL: number;
  preBoilVolumeL: number;
  /** Measured hot, right after the boil. */
  postBoilVolumeL: number;
  /** In the kettle after cooling, before kettle/chiller/transfer losses. */
  cooledVolumeL: number;
  grainAbsorptionL: number;
  evaporatedL: number;
}

/**
 * Works backwards from the volume wanted in the fermenter to the water needed:
 * fermenter ← losses ← cooling shrinkage ← boil-off ← pre-boil ← absorption/dead space ← water.
 */
export function calculateWaterVolumes(input: WaterVolumeInput): WaterVolumeResult {
  const shrinkage = (input.coolingShrinkagePct ?? 4) / 100;
  const cooledVolumeL =
    input.batchVolumeL + (input.kettleLossL ?? 0) + (input.chillerLossL ?? 0) + (input.transferLossL ?? 0);
  const postBoilVolumeL = cooledVolumeL / (1 - shrinkage);
  const evaporatedL = input.boilOffLPerH * (input.boilTimeMin / 60);
  const preBoilVolumeL = postBoilVolumeL + evaporatedL;
  const grainAbsorptionL = input.grainKg * input.grainAbsorptionLPerKg;
  const totalWaterL = preBoilVolumeL + grainAbsorptionL + (input.mashDeadSpaceL ?? 0) + (input.pumpPipeLossL ?? 0);
  const mashWaterL = Math.min(totalWaterL, input.grainKg * input.mashThicknessLPerKg);
  return {
    mashWaterL,
    spargeWaterL: totalWaterL - mashWaterL,
    totalWaterL,
    preBoilVolumeL,
    postBoilVolumeL,
    cooledVolumeL,
    grainAbsorptionL,
    evaporatedL,
  };
}

/**
 * Strike water temperature for a single infusion (Palmer, metric):
 *   Tw = (0.41 / r) · (T_target − T_grain) + T_target
 * where r is the mash thickness in L/kg. `systemOffsetC` is the brewery's calibrated
 * correction for heat lost to the mash tun and is added on top.
 */
export function calculateStrikeTemperature(input: {
  targetMashTempC: number;
  grainTempC: number;
  mashThicknessLPerKg: number;
  systemOffsetC?: number;
}): { strikeTempC: number; baseStrikeTempC: number; systemOffsetC: number } {
  if (input.mashThicknessLPerKg <= 0) throw new RangeError("mashThicknessLPerKg must be positive");
  const baseStrikeTempC =
    (0.41 / input.mashThicknessLPerKg) * (input.targetMashTempC - input.grainTempC) + input.targetMashTempC;
  const systemOffsetC = input.systemOffsetC ?? 0;
  return { strikeTempC: baseStrikeTempC + systemOffsetC, baseStrikeTempC, systemOffsetC };
}

/** Temperature expected after a transfer given the calibrated delta (negative = loss). */
export function calculateVolumeTransfer(input: {
  volumeL: number;
  lossL: number;
  temperatureC?: number;
  temperatureDeltaC?: number;
}): { volumeL: number; temperatureC: number | undefined } {
  return {
    volumeL: Math.max(0, input.volumeL - input.lossL),
    temperatureC: input.temperatureC === undefined ? undefined : input.temperatureC + (input.temperatureDeltaC ?? 0),
  };
}

/** Specific heat of grain relative to water (Palmer: 0.4 cal/g·°C). */
export const GRAIN_SPECIFIC_HEAT = 0.4;

/**
 * Water to add to move the mash from its current to its target temperature (heat balance):
 *   (m_grain·c_grain + m_water + m_tun·c_tun) · (T_target − T_now) = m_add · (T_add − T_target)
 * with water at 1 kg/L and c = 1. Positive result = litres to add. Returns null when the added
 * water cannot move the mash that way (e.g. 70 °C water to reach 72 °C).
 * Reference: BeerSmith Mash Adjust, 18.93 L, 4.54 kg, 65.6 → 67.8 °C with 100 °C water → 1.41 L.
 */
export function calculateMashTemperatureAdjustment(input: {
  mashWaterL: number;
  grainKg: number;
  currentTempC: number;
  targetTempC: number;
  additionTempC: number;
  tunMassKg?: number;
  tunSpecificHeat?: number;
}): { additionL: number } | null {
  const heatCapacity =
    input.grainKg * GRAIN_SPECIFIC_HEAT + input.mashWaterL + (input.tunMassKg ?? 0) * (input.tunSpecificHeat ?? 0);
  const needed = heatCapacity * (input.targetTempC - input.currentTempC);
  const perLitre = input.additionTempC - input.targetTempC;
  if (perLitre === 0 || Math.sign(needed) !== Math.sign(perLitre)) return needed === 0 ? { additionL: 0 } : null;
  return { additionL: needed / perLitre };
}

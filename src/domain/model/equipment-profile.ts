/**
 * Registry of calibration parameters that make up a brewery's equipment profile.
 * Values are stored per profile version in `equipment_profile_values` (key → number).
 * A missing value means "not calibrated"; calculations then fall back to `defaultValue`.
 */

export const profileGroups = ["capacity", "losses", "boil", "efficiency", "mash", "temperature", "instruments"] as const;
export type ProfileGroup = (typeof profileGroups)[number];

export const profileGroupLabels: Record<ProfileGroup, string> = {
  capacity: "Kapasitet",
  losses: "Volumtap",
  boil: "Kok",
  efficiency: "Effektivitet",
  mash: "Mesk",
  temperature: "Temperatur",
  instruments: "Instrumenter",
};

export interface ProfileParameter {
  key: string;
  group: ProfileGroup;
  label: string;
  unit: string;
  description?: string;
  defaultValue?: number;
  min: number;
  max: number;
}

export const profileParameters = [
  { key: "batch_volume_l", group: "capacity", label: "Standard batchvolum til gjæring", unit: "L", min: 1, max: 10_000 },
  { key: "mash_tun_volume_l", group: "capacity", label: "Meskekar", unit: "L", min: 1, max: 10_000 },
  { key: "kettle_volume_l", group: "capacity", label: "Kokekar", unit: "L", min: 1, max: 10_000 },
  { key: "fermenter_capacity_l", group: "capacity", label: "Gjæringskapasitet totalt", unit: "L", min: 1, max: 10_000 },

  { key: "mash_dead_space_l", group: "losses", label: "Dødvolum i meskekar", unit: "L", defaultValue: 0, min: 0, max: 500 },
  { key: "pump_pipe_loss_l", group: "losses", label: "Tap i pumpe og rør", unit: "L", defaultValue: 0, min: 0, max: 500 },
  { key: "kettle_loss_l", group: "losses", label: "Tap i kokekar (trub)", unit: "L", defaultValue: 0, min: 0, max: 500 },
  { key: "chiller_loss_l", group: "losses", label: "Tap i kjøler", unit: "L", defaultValue: 0, min: 0, max: 500 },
  { key: "transfer_loss_l", group: "losses", label: "Overføringstap til gjæringskar", unit: "L", defaultValue: 0, min: 0, max: 500 },
  { key: "fermentation_loss_l", group: "losses", label: "Tap i gjæring", unit: "L", defaultValue: 0, min: 0, max: 500 },
  {
    key: "grain_absorption_l_per_kg",
    group: "losses",
    label: "Kornabsorpsjon",
    unit: "L/kg",
    defaultValue: 0.8,
    min: 0,
    max: 3,
  },

  { key: "boil_off_l_per_h", group: "boil", label: "Fordampning", unit: "L/h", min: 0, max: 200 },
  { key: "min_boil_volume_l", group: "boil", label: "Minimum kokevolum", unit: "L", min: 0, max: 10_000 },
  {
    key: "cooling_shrinkage_pct",
    group: "boil",
    label: "Krymping ved nedkjøling",
    unit: "%",
    defaultValue: 4,
    min: 0,
    max: 10,
  },

  { key: "mash_efficiency_pct", group: "efficiency", label: "Mesk-effektivitet", unit: "%", min: 1, max: 100 },
  {
    key: "brewhouse_efficiency_pct",
    group: "efficiency",
    label: "Brygghuseffektivitet",
    unit: "%",
    defaultValue: 72,
    min: 1,
    max: 100,
  },

  {
    key: "mash_thickness_l_per_kg",
    group: "mash",
    label: "Mesketykkelse",
    unit: "L/kg",
    defaultValue: 3,
    min: 1,
    max: 10,
  },
  { key: "grain_temperature_c", group: "mash", label: "Typisk korntemperatur", unit: "°C", defaultValue: 18, min: -10, max: 40 },

  {
    key: "strike_temp_offset_c",
    group: "temperature",
    label: "Systemkorreksjon innmesking",
    unit: "°C",
    description: "Legges til beregnet innmeskingstemperatur for å kompensere for varmetap i karet.",
    defaultValue: 0,
    min: -10,
    max: 15,
  },
  {
    key: "mash_to_kettle_temp_delta_c",
    group: "temperature",
    label: "Temperaturendring meskekar → kokekar",
    unit: "°C",
    description: "Observert endring gjennom pumpe og rør. Negativ verdi betyr tap.",
    defaultValue: 0,
    min: -20,
    max: 5,
  },

  {
    key: "refractometer_wcf",
    group: "instruments",
    label: "Refraktometer korreksjonsfaktor (WCF)",
    unit: "",
    description: "1,00 betyr ingen korreksjon. Brukes når Brix regnes om til SG.",
    defaultValue: 1,
    min: 0.9,
    max: 1.2,
  },
] as const satisfies readonly ProfileParameter[];

export type ProfileParameterKey = (typeof profileParameters)[number]["key"];
export type ProfileValues = Partial<Record<ProfileParameterKey, number>>;

const byKey = new Map<string, ProfileParameter>(profileParameters.map((p) => [p.key, p]));

export function getProfileParameter(key: string): ProfileParameter | undefined {
  return byKey.get(key);
}

export function isProfileParameterKey(key: string): key is ProfileParameterKey {
  return byKey.has(key);
}

/** Value from the profile, or the parameter's default when uncalibrated. */
export function profileValue(values: ProfileValues, key: ProfileParameterKey): number | undefined {
  return values[key] ?? byKey.get(key)?.defaultValue;
}

/** Values written into profile v1 when a brewery is created. */
export function defaultProfileValues(): ProfileValues {
  const values: ProfileValues = {};
  for (const parameter of profileParameters) {
    if ("defaultValue" in parameter) values[parameter.key] = parameter.defaultValue;
  }
  return values;
}

export const equipmentKinds = ["mash_tun", "kettle", "fermenter", "pump", "chiller", "keg", "instrument", "other"] as const;
export type EquipmentKind = (typeof equipmentKinds)[number];

export const equipmentKindLabels: Record<EquipmentKind, string> = {
  mash_tun: "Meskekar",
  kettle: "Kokekar",
  fermenter: "Gjæringskar",
  pump: "Pumpe",
  chiller: "Kjøler",
  keg: "Fat",
  instrument: "Instrument",
  other: "Annet",
};

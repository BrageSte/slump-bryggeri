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
  /** Norwegian explanation of an uncalibrated fallback and how to replace it with a measurement. */
  defaultExplanation?: string;
  measureToReplaceDefault?: string;
  min: number;
  max: number;
}

export type ProfileValueSource = "manual" | "calibration" | "default";
export type ProfileValueSources = Partial<Record<ProfileParameterKey, ProfileValueSource>>;

export const profileParameters = [
  { key: "batch_volume_l", group: "capacity", label: "Standard batchvolum til gjæring", unit: "L", min: 1, max: 10_000 },
  { key: "mash_tun_volume_l", group: "capacity", label: "Meskekar", unit: "L", min: 1, max: 10_000 },
  { key: "kettle_volume_l", group: "capacity", label: "Kokekar", unit: "L", min: 1, max: 10_000 },
  { key: "fermenter_capacity_l", group: "capacity", label: "Gjæringskapasitet totalt", unit: "L", min: 1, max: 10_000 },

  {
    key: "mash_dead_space_l", group: "losses", label: "Dødvolum i meskekar", unit: "L", defaultValue: 0,
    defaultExplanation: "Foreløpig antas ikke-målt volum i meskekaret å være 0 L.",
    measureToReplaceDefault: "Mål vannmengden som blir igjen i meskekaret etter avtapping.", min: 0, max: 500,
  },
  {
    key: "pump_pipe_loss_l", group: "losses", label: "Tap i pumpe og rør", unit: "L", defaultValue: 0,
    defaultExplanation: "Foreløpig antas ikke-målt tap i pumpe og rør å være 0 L.",
    measureToReplaceDefault: "Mål volumet før og etter overføring gjennom pumpe og rør.", min: 0, max: 500,
  },
  {
    key: "kettle_loss_l", group: "losses", label: "Tap i kokekar (trub)", unit: "L", defaultValue: 0,
    defaultExplanation: "Foreløpig antas ikke-målt trubtap i kokekaret å være 0 L.",
    measureToReplaceDefault: "Mål volumet som blir igjen i kokekaret etter overføring.", min: 0, max: 500,
  },
  {
    key: "chiller_loss_l", group: "losses", label: "Tap i kjøler", unit: "L", defaultValue: 0,
    defaultExplanation: "Foreløpig antas ikke-målt væske i kjøleren å være 0 L.",
    measureToReplaceDefault: "Mål volumet før kjøleren og volumet som kommer ut.", min: 0, max: 500,
  },
  {
    key: "transfer_loss_l", group: "losses", label: "Overføringstap til gjæringskar", unit: "L", defaultValue: 0,
    defaultExplanation: "Foreløpig antas ikke-målt overføringstap til gjæringskar å være 0 L.",
    measureToReplaceDefault: "Mål avkjølt volum før og etter overføring til gjæringskaret.", min: 0, max: 500,
  },
  {
    key: "fermentation_loss_l", group: "losses", label: "Tap i gjæring", unit: "L", defaultValue: 0,
    defaultExplanation: "Foreløpig antas ikke-målt tap i gjæringskaret å være 0 L.",
    measureToReplaceDefault: "Mål volumet ved gjæringsstart og før tapping.", min: 0, max: 500,
  },
  {
    key: "grain_absorption_l_per_kg",
    group: "losses",
    label: "Kornabsorpsjon",
    unit: "L/kg",
    defaultValue: 0.8,
    defaultExplanation: "Antatt 0,8 L/kg korn holdes tilbake etter mesking; dette er et vanlig startanslag.",
    measureToReplaceDefault: "Mål meskevann inn og vørter ut av meskekaret.",
    min: 0,
    max: 3,
  },

  {
    // 5 L/h is a practical starting estimate for a 60–100 L electric or gas kettle, not a calibration.
    key: "boil_off_l_per_h", group: "boil", label: "Fordampning", unit: "L/h", defaultValue: 5,
    defaultExplanation: "Antatt 5 L/t, et moderat startanslag for elektriske eller gassfyrte kokekar på 60–100 L.",
    measureToReplaceDefault: "Mål volum før og etter kok, så regnes fordampningen ut.", min: 0, max: 200,
  },
  { key: "min_boil_volume_l", group: "boil", label: "Minimum kokevolum", unit: "L", min: 0, max: 10_000 },
  {
    key: "cooling_shrinkage_pct",
    group: "boil",
    label: "Krymping ved nedkjøling",
    unit: "%",
    defaultValue: 4,
    defaultExplanation: "Antatt 4 % krymping når varm vørter kjøles; samme standard som BeerSmith.",
    measureToReplaceDefault: "Mål samme vørtervolum varmt etter kok og avkjølt før overføring.",
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
    defaultExplanation: "72 % er et nøkternt standardanslag til en oppskrift har egne tall.",
    measureToReplaceDefault: "Mål volum og SG etter kok og sammenlign med maltutbyttet.",
    min: 1,
    max: 100,
  },

  {
    key: "mash_thickness_l_per_kg",
    group: "mash",
    label: "Mesketykkelse",
    unit: "L/kg",
    defaultValue: 3,
    defaultExplanation: "Antatt 3 L/kg som et vanlig startpunkt for hovedmesken.",
    measureToReplaceDefault: "Logg meskevann og maltmengde når dere brygger.",
    min: 1,
    max: 10,
  },
  {
    key: "grain_temperature_c", group: "mash", label: "Typisk korntemperatur", unit: "°C", defaultValue: 18,
    defaultExplanation: "Antatt romtemperert malt på 18 °C før innmesking.",
    measureToReplaceDefault: "Mål temperaturen i malten rett før innmesking.", min: -10, max: 40,
  },
  {
    key: "sparge_temperature_c", group: "mash", label: "Skyllevanntemperatur", unit: "°C", defaultValue: 77.5,
    defaultExplanation: "Antatt 77,5 °C som et vanlig mål for skyllevann når oppskriften ikke oppgir temperatur.",
    measureToReplaceDefault: "Logg temperaturen på skyllevannet idet det tilsettes.", min: 20, max: 100,
  },

  {
    key: "strike_temp_offset_c",
    group: "temperature",
    label: "Systemkorreksjon innmesking",
    unit: "°C",
    description: "Legges til beregnet innmeskingstemperatur for å kompensere for varmetap i karet.",
    defaultValue: 0,
    defaultExplanation: "Ingen systemkorreksjon antas før temperaturavvik er målt.",
    measureToReplaceDefault: "Mål mesketemperaturen etter innmesking og juster neste profilversjon.",
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
    defaultExplanation: "Ingen temperaturendring antas før overføringstapet er målt.",
    measureToReplaceDefault: "Mål temperaturen i meskekaret og kokekaret ved samme overføring.",
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
    defaultExplanation: "Antatt WCF 1,00 betyr at refraktometeret ikke trenger korreksjon.",
    measureToReplaceDefault: "Kalibrer refraktometeret mot en SG-måling av samme vørter.",
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

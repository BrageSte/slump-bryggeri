/**
 * Slump's own BeerSmith recipes for today's 90–100 L brewhouse, offered as a one-tap import.
 * Loaded on demand so the files never weigh down the rest of the app. The other files in this
 * folder (older systems, a 25 L cooler, a scaled duplicate) stay test fixtures and can still be
 * imported by uploading them.
 */
export async function loadSlumpBeerSmithFiles(): Promise<{ name: string; text: string }[]> {
  const files = await Promise.all([
    import("./Love_in_a_canoe.bsmx?raw").then((m) => ({ name: "Love_in_a_canoe.bsmx", text: m.default })),
    import("./Cascade_Pale_Ale__Kveik.bsmx?raw").then((m) => ({ name: "Cascade_Pale_Ale__Kveik.bsmx", text: m.default })),
    import("./Bitter_90l.bsmx?raw").then((m) => ({ name: "Bitter_90l.bsmx", text: m.default })),
    import("./Aasen_Klch.bsmx?raw").then((m) => ({ name: "Aasen_Klch.bsmx", text: m.default })),
  ]);
  return files;
}

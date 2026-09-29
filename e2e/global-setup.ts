import { mkdirSync } from "node:fs";
import { request, type FullConfig } from "@playwright/test";

const PERSON = "Brage";

/**
 * Picks the brewery's first person (who becomes its admin) and saves the device cookies that every
 * test reuses. Done once and in sequence: two people created at the same time on an empty database
 * would each create their own brewery. Safe to run again against a server that is being reused.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("baseURL is not set in playwright.config.ts");

  const api = await request.newContext({ baseURL });
  try {
    const mode = (await (await api.get("/api/mode")).json()) as { people: { id: string; name: string }[] | null };
    const existing = mode.people?.find((person) => person.name === PERSON);
    const response = await api.post("/api/brewery-mode/person", { data: existing ? { userId: existing.id } : { name: PERSON } });
    if (!response.ok()) throw new Error(`Could not choose ${PERSON}: ${response.status()} ${await response.text()}`);
    mkdirSync("e2e/.auth", { recursive: true });
    await api.storageState({ path: "e2e/.auth/brage.json" });
  } finally {
    await api.dispose();
  }
}

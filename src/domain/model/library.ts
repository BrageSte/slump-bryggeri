/**
 * Recipe library: public reference recipes (read-only, shared by all breweries) that can be
 * copied into a brewery's own recipes.
 */

export const libraryCategories = [
  { key: "ipa", label: "IPA", match: /\b(ipa|india pale)\b/i },
  { key: "pale", label: "Pale ale", match: /pale ale|\bapa\b|\bsession\b/i },
  { key: "stout", label: "Stout og porter", match: /stout|porter/i },
  { key: "lager", label: "Lager og pils", match: /lager|pils|helles|\bbock\b|m[äa]rzen|dunkel|kellerbier/i },
  { key: "sour", label: "Surøl", match: /\bsour\b|gose|berliner|lambic|\bbrett|wild ale/i },
  { key: "wheat", label: "Hvete", match: /wheat|weiss|weizen|witbier|\bwit\b|hefe/i },
  { key: "belgian", label: "Belgisk og saison", match: /belgian|saison|tripel|dubbel|quadrupel|abbey|farmhouse/i },
  { key: "strong", label: "Sterkt øl", match: /barley ?wine|imperial|\bdouble\b|\btriple\b|strong ale|old ale/i },
  { key: "amber", label: "Amber, rød og brun", match: /\bred\b|amber|\bbrown\b|scotch|scottish|rye/i },
] as const;

export type LibraryCategory = (typeof libraryCategories)[number]["key"] | "other";

export const libraryCategoryKeys = [
  "ipa",
  "pale",
  "stout",
  "lager",
  "sour",
  "wheat",
  "belgian",
  "strong",
  "amber",
  "other",
] as const satisfies readonly LibraryCategory[];

export const libraryCategoryLabels: Record<LibraryCategory, string> = {
  ...(Object.fromEntries(libraryCategories.map((c) => [c.key, c.label])) as Record<(typeof libraryCategories)[number]["key"], string>),
  other: "Annet",
};

/**
 * Best-effort category from the recipe's own words. Name and tagline are checked before the
 * description, which often mentions other beers ("unlike our IPA …").
 */
export function inferLibraryCategory(name: string, tagline = "", description = ""): LibraryCategory {
  for (const text of [`${name} ${tagline}`, description]) {
    const hit = libraryCategories.find((c) => c.match.test(text));
    if (hit) return hit.key;
  }
  return "other";
}

export interface LibrarySource {
  key: string;
  name: string;
  license: string;
  homepage: string;
}

export const librarySources: Record<string, LibrarySource> = {
  diydog: {
    key: "diydog",
    name: "BrewDog DIY Dog",
    license: "MIT (datasett fra punkapi)",
    homepage: "https://github.com/alxiw/punkapi",
  },
};

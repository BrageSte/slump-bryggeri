/**
 * Restrict assistant web search to official brewing ingredient documentation and established
 * brewing organizations, so product specifications and style ranges come from authoritative sources.
 */
export const ASSISTANT_WEB_SEARCH_SOURCES = [
  { domain: "yakimachief.com", organization: "Yakima Chief" },
  { domain: "barthhaas.com", organization: "BarthHaas" },
  { domain: "hopsteiner.com", organization: "Hopsteiner" },
  { domain: "fermentis.com", organization: "Fermentis" },
  { domain: "lallemandbrewing.com", organization: "Lallemand" },
  { domain: "whitelabs.com", organization: "White Labs" },
  { domain: "wyeastlab.com", organization: "Wyeast" },
  { domain: "omegayeast.com", organization: "Omega Yeast" },
  { domain: "weyermann.de", organization: "Weyermann" },
  { domain: "bestmalz.de", organization: "BESTMALZ" },
  { domain: "castlemalting.com", organization: "Castle Malting" },
  { domain: "bjcp.org", organization: "BJCP" },
  { domain: "brewersassociation.org", organization: "Brewers Association" },
] as const;

export type AssistantWebSearchSource = (typeof ASSISTANT_WEB_SEARCH_SOURCES)[number];

export function assistantWebSourceForUrl(url: string): AssistantWebSearchSource | null {
  let hostname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    hostname = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }

  return ASSISTANT_WEB_SEARCH_SOURCES.find(({ domain }) => hostname === domain || hostname.endsWith(`.${domain}`)) ?? null;
}

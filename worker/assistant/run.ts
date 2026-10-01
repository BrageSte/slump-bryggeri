import type Anthropic from "@anthropic-ai/sdk";
import type { BrewDocumentSections } from "../../src/domain/brew-document/brew-document.ts";
import type { AssistantCitation, AssistantProposedAction, BatchDetail, TimelineItem } from "../../src/domain/model/api.ts";
import { ASSISTANT_WEB_SEARCH_SOURCES, assistantWebSourceForUrl } from "../../src/domain/model/assistant-sources.ts";
import { assistantToolDefinitions, runAssistantTool } from "./tools.ts";

/** Stable instructions; kept byte-identical between requests so the prompt cache holds. */
export const ASSISTANT_SYSTEM_PROMPT = `You are the brewing assistant for Slump Bryggeri. Answer in Norwegian bokmål.

Check before answering:
1. Answer from the brief when it contains enough information.
2. Otherwise fetch only the section needed with get_batch_section, one section at a time. Fetch the full log only for history or timeline questions.
3. Use brewery_history only for calibration questions, "what is normal for us?" questions, or how earlier batches' water, salts, acid and pH compare.
4. Never do arithmetic yourself, including sums and differences. Use a calculation tool or state the individual values.
5. Say "ikke målt" instead of guessing. Keep answers short and practical for a brewer using a phone; use metric units.
6. Water chemistry (source water, planned water, salts, acids, pH): use the water_chemistry tool or the "water" section; never compute ion concentrations, alkalinity, hardness or salt amounts yourself. Always say which of four things you mean and keep them apart: values the supplier reports (source water), values the app calculates, recommended targets (general guidance windows, not rules; sources disagree at the edges), and measurements from this brew. The app has no mash pH prediction and no acid dosing: do not estimate them. Say so, and suggest measuring a cooled sample (about 20-25 °C). The pH of the raw water says little about mash pH, which depends on the grain bill, calcium and acid.
7. Search the web only when the answer depends on specific external facts absent from the batch context and tools (hop alpha acids or oil, yeast temperature or attenuation ranges, malt color or extract, or style guideline ranges), or when the brewer explicitly asks for a source. Never search this batch's data, brewery history, or anything a calculation tool answers. Prefer one focused query. If no reliable result is found, say so instead of guessing. For web facts, name the organization and link; note crop-year and lot variation for hops. Answer well-established brewing practice without searching, labelled as general guidance rather than a fact about this batch.

When the brewer reports a reading or something that happened, propose logging it with propose_actions instead of telling them to log it. Proposed actions are only suggestions: the brewer must confirm each one, and you never execute a write. Keep planned recipe values, calculated values marked "≈", and measured values distinct. Explain calibration observations without applying them; one batch is weak evidence and an admin decides whether to save a new profile version. If a needed calculation tool is unavailable, say so instead of estimating. For unrelated questions, answer briefly or say they are outside your scope.`;

export interface AssistantUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearchRequests: number;
}

export interface AssistantRunResult {
  text: string;
  toolCalls: string[];
  actions: AssistantProposedAction[];
  citations: AssistantCitation[];
  stopReason: string | null;
}

/** The slice of the SDK client the loop uses, so tests can pass a fake. */
export interface MessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

const MAX_TOOL_ROUNDS = 6;
const MAX_WEB_SEARCH_REQUESTS = 2;

function collectWebCitations(content: Anthropic.Message["content"], citations: Map<string, AssistantCitation>): void {
  for (const block of content) {
    if (block.type !== "text" || !block.citations) continue;
    for (const citation of block.citations) {
      if (citation.type !== "web_search_result_location" || !assistantWebSourceForUrl(citation.url)) continue;
      if (!citations.has(citation.url)) citations.set(citation.url, { url: citation.url, title: citation.title });
    }
  }
}

export async function runAssistant(input: {
  client: MessagesClient;
  model: string;
  brief: string;
  brewDocumentSections: BrewDocumentSections;
  loadBreweryHistory?: () => Promise<unknown>;
  history: { role: "user" | "assistant"; content: string }[];
  batch: BatchDetail;
  timeline?: TimelineItem[];
  webSearchEnabled?: boolean;
  /** Called after every API response, so usage is recorded even if a later round fails. */
  onUsage: (usage: AssistantUsage) => void;
}): Promise<AssistantRunResult> {
  const messages: Anthropic.MessageParam[] = input.history.map((m) => ({ role: m.role, content: m.content }));
  const toolCalls: string[] = [];
  const actions: AssistantProposedAction[] = [];
  const citations = new Map<string, AssistantCitation>();
  let webSearchRequests = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const lastRound = round === MAX_TOOL_ROUNDS;
    const tools: Anthropic.ToolUnion[] = [...assistantToolDefinitions];
    const remainingSearchRequests = MAX_WEB_SEARCH_REQUESTS - webSearchRequests;
    if (input.webSearchEnabled !== false && remainingSearchRequests > 0) {
      tools.push({
        type: "web_search_20260209",
        name: "web_search",
        max_uses: remainingSearchRequests,
        allowed_domains: ASSISTANT_WEB_SEARCH_SOURCES.map(({ domain }) => domain),
      });
    }
    const response = await input.client.messages.create({
      model: input.model,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: [
        { type: "text", text: ASSISTANT_SYSTEM_PROMPT },
        // The brief changes with the batch, but stays fixed within one question's tool rounds.
        { type: "text", text: input.brief, cache_control: { type: "ephemeral" } },
      ],
      tools,
      // After the last allowed round, ask for an answer with what it has.
      ...(lastRound ? { tool_choice: { type: "none" as const } } : {}),
      messages,
    });
    const roundUsage: AssistantUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      webSearchRequests: response.usage.server_tool_use?.web_search_requests ?? 0,
    };
    webSearchRequests += roundUsage.webSearchRequests;
    input.onUsage(roundUsage);
    collectWebCitations(response.content, citations);

    if (response.stop_reason === "pause_turn") {
      // Server-side tool output and citation-bearing text are opaque SDK blocks; send the full turn back unchanged.
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    if (response.stop_reason === "tool_use" && !lastRound) {
      // Pass the whole turn back unchanged: thinking and server-side search blocks accompany client tool calls.
      messages.push({ role: "assistant", content: response.content });
      const toolUses = response.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (block) => {
          toolCalls.push(block.name);
          const result = await runAssistantTool(block.name, block.input, {
            batch: input.batch,
            timeline: input.timeline,
            brewDocumentSections: input.brewDocumentSections,
            loadBreweryHistory: input.loadBreweryHistory,
            proposedActions: actions,
          });
          return { type: "tool_result", tool_use_id: block.id, content: result.content, is_error: result.isError };
        }),
      );
      if (results.length > 0) {
        // All results of one turn go back in a single user message.
        messages.push({ role: "user", content: results });
        continue;
      }
      if (response.content.some((block) => block.type === "server_tool_use" || block.type === "web_search_tool_result")) continue;
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (response.stop_reason === "refusal") {
      return { text: "Assistenten kunne ikke svare på dette. Prøv å formulere spørsmålet annerledes.", toolCalls, actions, citations: [...citations.values()], stopReason: "refusal" };
    }
    const truncated = response.stop_reason === "max_tokens" ? "\n\n(Svaret ble avkortet.)" : "";
    return { text: (text || "Assistenten ga ikke noe svar. Prøv igjen.") + truncated, toolCalls, actions, citations: [...citations.values()], stopReason: response.stop_reason };
  }
  return { text: "Assistenten brukte for mange beregninger. Prøv et mer avgrenset spørsmål.", toolCalls, actions, citations: [...citations.values()], stopReason: null };
}

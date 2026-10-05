import type Anthropic from "@anthropic-ai/sdk";
import type { BrewDocumentSections } from "../../src/domain/brew-document/brew-document.ts";
import type { AssistantCitation, AssistantReplyAction, BatchDetail, TimelineItem } from "../../src/domain/model/api.ts";
import { ASSISTANT_WEB_SEARCH_SOURCES, assistantWebSourceForUrl } from "../../src/domain/model/assistant-sources.ts";
import { assistantToolDefinitions, breweryToolDefinitions, runAssistantTool, type BreweryToolContext } from "./tools.ts";

/** Stable instructions; kept byte-identical between requests so the prompt cache holds. */
export const ASSISTANT_SYSTEM_PROMPT = `You are the brewing assistant for Slump Bryggeri. Answer in Norwegian bokmål.

Understand the whole message before choosing tools. Identify every question and distinguish observed readings from plans, targets, hypotheticals, quotations and already logged values. A number such as "18 grader" is not automatically a new measurement.
Answer every part of the brewer's question with interpretation and a useful next step before mentioning logging. Short means concise, not incomplete. A log proposal is secondary and must never replace advice, comparison or diagnosis. Do not narrate routine lookups. If there are no actions to propose, give a complete final answer directly; do not call propose_actions with an empty list or refer to internal messages as an earlier displayed answer. Usually use 3-6 concise sentences: the answer, the evidence or important uncertainty, and the next practical step. Do not repeat the whole fermentation schedule unless asked. Do not end with an invitation to log, and do not narrate why no action was proposed unless the brewer explicitly asked about logging. Ask one focused clarification only when the missing detail changes the advice or what would be logged; answer what you can meanwhile.

Check before answering:
1. Answer from the brief when it contains enough information.
2. Otherwise fetch only the section needed with get_batch_section, one section at a time. Fetch the full log only for history or timeline questions.
3. For advice or troubleshooting about this beer, including a hypothetical, inspect the relevant recipe plan with get_batch_section if the brief does not give its yeast, target and timing. Never treat an unlogged ingredient as proof it was not added, or bubbles alone as proof of ongoing fermentation. Completion depends on stable measured gravity and the recipe's completion criteria, not matching the estimated FG; recipe guidance takes precedence over generic guidance. If gravity values or dates are missing, say what cannot be confirmed.
4. Use brewery_history only for calibration questions, "what is normal for us?" questions, or how earlier batches' water, salts, acid and pH compare.
5. Never do arithmetic yourself, including sums and differences. Use a calculation tool or state the individual values.
6. Say "ikke målt" instead of guessing. Keep answers short and practical for a brewer using a phone; use metric units.
7. Water chemistry (source water, planned water, salts, acids, pH): use the water_chemistry tool or the "water" section; never compute ion concentrations, alkalinity, hardness or salt amounts yourself. Always say which of four things you mean and keep them apart: values the supplier reports (source water), values the app calculates, recommended targets (general guidance windows, not rules; sources disagree at the edges), and measurements from this brew. The app has no mash pH prediction and no acid dosing: do not estimate them. Say so, and suggest measuring a cooled sample (about 20-25 °C). The pH of the raw water says little about mash pH, which depends on the grain bill, calcium and acid.
8. Search the web only when the answer depends on specific external facts absent from the batch context and tools (hop alpha acids or oil, yeast temperature or attenuation ranges, malt color or extract, or style guideline ranges), or when the brewer explicitly asks for a source. Never search this batch's data, brewery history, or anything a calculation tool answers. Prefer one focused query. If no reliable result is found, say so instead of guessing. For web facts, name the organization and link; note crop-year and lot variation for hops. Answer well-established brewing practice without searching, labelled as general guidance rather than a fact about this batch.

When the brewer clearly reports a new actual reading or something that happened in this batch, propose logging it with propose_actions after addressing their questions. The propose_actions tool requires an answer field: put the concise answer to ALL questions there, not just a logging acknowledgement. The app displays it before the cards, so do not repeat it afterwards. For a pure logging request, a short acknowledgement is enough. Never propose a plan, target, hypothetical, quotation, value from another batch, or a reading already in the log as a new measurement. If the brewer says not to log it, offer no action. If what was measured, which split, or when is unclear, do not invent it. For a vessel-specific reading, use its splitId from the brief; naming the vessel in label is not enough. For an unresolved earlier observation, use the brewer's clarification in the current message and the earlier value, then answer the follow-up too.
A correction of an existing reading is not a new observation: explain how to use the correction control in the log instead of propose_actions. A historical reading needs its original timestamp; this tool cannot set timestamps, so explain manual logging with the correct time instead of making a card that would log it as now. A statement that values are already logged is not a new observation, even if a number is repeated. Use a short label for the confirmed observation, not an explanation of the advice. Do not ask "skal jeg logge?" when the confirmation card already lets the brewer choose.

Examples:
- "Vi målte 18 grader. Er det riktig for gjæren, og bør vi øke?": inspect this batch's yeast and fermentation plan, answer both questions and what matters next, then offer the confirmed measurement if its vessel/split is clear.
- "Bør vi gjære på 18 grader?": explain the planned temperature; no measurement proposal.
- "Hvis vi måler 18 i morgen, hva gjør vi?": answer the hypothetical; no measurement proposal.
- "Det står 18 i loggen, men gjæringen stopper. Hva sjekker vi?": diagnose using existing readings and recipe; no duplicate proposal.
- "Ikke logg noe. Vi målte 18; bør vi øke?": answer the question without any proposal.
 Proposed actions are only suggestions: the brewer must confirm each one, and you never execute a write. Keep planned recipe values, calculated values marked "≈", and measured values distinct. Explain calibration observations without applying them; one batch is weak evidence and an admin decides whether to save a new profile version. If a needed calculation tool is unavailable, say so instead of estimating. For unrelated questions, answer briefly or say they are outside your scope.`;

/** The brewery thread: recipes, equipment and brewing in general. Stable, like the batch prompt, so the cache holds. */
export const BREWERY_ASSISTANT_SYSTEM_PROMPT = `You are the brewing assistant for Slump Bryggeri, in the brewery's shared conversation about recipes, equipment and brewing in general (not about one batch). Answer in Norwegian bokmål.

The brief gives the active equipment profile, the base water and the recipe list. Work like this:
1. Read the whole message and answer all its questions before offering a draft. Do not turn a question about an existing recipe into a new design unless the brewer asks for a change. Short first. Give a brief answer or proposal (a few lines for a phone). Give the full ingredient list, the reasoning and alternatives only when the brewer asks for them.
2. To make a recipe or change one: choose the structure, then call design_recipe. The app computes every amount (kg of malt, g of hops, g of salts) and returns the finished recipe with its calculated OG, FG, ABV, IBU and colour. Present only numbers it returned. Never state, adjust or round an amount yourself. Never say a recipe is saved: the brewer opens the draft and saves it. To change an existing recipe, find it with list_recipes, read it with get_recipe, and pass basedOnRecipeId to design_recipe.
3. Never do arithmetic yourself, including sums, differences, percentages and conversions of amounts. Use a tool or quote the numbers a tool returned. Ask or say "ikke målt" instead of guessing.
4. If design_recipe fails, or its targetComparison shows a target that is not met (withinTolerance false), say so plainly. Either change the structure and call it again, or explain what cannot be reached. Do not claim a target was met when it was not.
5. Defaults come from the equipment profile in the brief. Use its batch size and efficiency unless the brewer says otherwise, and say which you used, especially when the efficiency is the unmeasured standard assumption (inputsUsed.efficiencyFrom says where it came from).
6. There is no inventory. If the brewer tells you in free text what they have at home, build around it and say what is missing and worth buying. Do not ask for a stock list.
7. Water: the base water is the supplier's reported values and is taken as it is; the brewer does not need an analysis. For salts, give design_recipe a water target and let the app compute the grams. The app has no mash pH prediction and no acid dosing: do not estimate them. Measuring mash pH is optional; suggest it only when it matters, on a cooled sample (about 20-25 °C). Keep reported, calculated, target and measured values apart.
8. Use brewery_history only for what the brewery's own batches show (efficiency, boil-off, attenuation per yeast, water and pH), for example to judge whether the efficiency in a recipe is realistic.
9. The alpha acid, colour and yield values you give design_recipe are typical values, not the brewer's lots: say so. Yeast dose follows the producer's general dosing; the app has no pitch-rate calculation. Search the web only when the answer depends on specific external facts (hop alpha acids or oil, yeast ranges, malt colour or extract, style guideline ranges) or the brewer asks for a source; prefer one focused query, name the organization and link, and say if nothing reliable turns up. Answer well-established brewing practice without searching, labelled as general guidance.
10. Make one recipe draft per answer unless the brewer asks for alternatives, and say in one line what the idea is. Keep answers practical, use metric units, and for unrelated questions answer briefly or say they are outside your scope.`;

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
  actions: AssistantReplyAction[];
  citations: AssistantCitation[];
  stopReason: string | null;
}

/** The slice of the SDK client the loop uses, so tests can pass a fake. */
export interface MessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

/** Adaptive thinking is unsupported on Haiku/Sonnet/Opus 4.5 and earlier. Keep the documented budget model switch usable. */
export function thinkingSettings(model: string): Pick<Anthropic.MessageCreateParamsNonStreaming, "thinking" | "output_config"> {
  const adaptive = /^claude-(?:sonnet|opus)-5(?:-|$)/.test(model)
    || /^claude-(?:fable|mythos)-5(?:-|$)/.test(model)
    || /^claude-sonnet-4-6(?:-|$)/.test(model)
    || /^claude-opus-4-[678](?:-|$)/.test(model);
  return adaptive ? { thinking: { type: "adaptive" }, output_config: { effort: "medium" } } : {};
}

const MAX_TOOL_ROUNDS = 6;
/** Designing a recipe can take a lookup, a history check and a retry after the design reports an inconsistency. */
const MAX_TOOL_ROUNDS_BREWERY = 8;
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
  /** The batch thread: the batch's brew document, snapshots and log. Exactly one of `batch` and `brewery` is given. */
  brewDocumentSections?: BrewDocumentSections;
  loadBreweryHistory?: () => Promise<unknown>;
  history: { role: "user" | "assistant"; content: string }[];
  batch?: BatchDetail;
  timeline?: TimelineItem[];
  /** The brewery thread: recipes, equipment profile and base water. */
  brewery?: BreweryToolContext;
  webSearchEnabled?: boolean;
  /** Called after every API response, so usage is recorded even if a later round fails. */
  onUsage: (usage: AssistantUsage) => void;
}): Promise<AssistantRunResult> {
  if ((input.batch === undefined) === (input.brewery === undefined)) throw new Error("runAssistant needs either a batch or a brewery, not both.");
  const systemPrompt = input.brewery ? BREWERY_ASSISTANT_SYSTEM_PROMPT : ASSISTANT_SYSTEM_PROMPT;
  const toolDefinitions = input.brewery ? breweryToolDefinitions : assistantToolDefinitions;
  const maxToolRounds = input.brewery ? MAX_TOOL_ROUNDS_BREWERY : MAX_TOOL_ROUNDS;
  const modelSettings = thinkingSettings(input.model);
  const messages: Anthropic.MessageParam[] = input.history.map((m) => ({ role: m.role, content: m.content }));
  const toolCalls: string[] = [];
  const actions: AssistantReplyAction[] = [];
  const citations = new Map<string, AssistantCitation>();
  // The proposal tool supplies a complete answer. Other intermediate text is a fallback, not a second copy.
  const answerParts: string[] = [];
  const intermediateText: string[] = [];
  const proposalRejections: string[] = [];
  let webSearchRequests = 0;
  let retriedEmptyAnswer = false;

  for (let round = 0; round <= maxToolRounds; round++) {
    const lastRound = round === maxToolRounds;
    const tools: Anthropic.ToolUnion[] = [...toolDefinitions];
    const remainingSearchRequests = MAX_WEB_SEARCH_REQUESTS - webSearchRequests;
    if (input.webSearchEnabled !== false && remainingSearchRequests > 0) {
      tools.push({
        type: modelSettings.thinking ? "web_search_20260209" : "web_search_20250305",
        name: "web_search",
        allowed_callers: ["direct"],
        max_uses: remainingSearchRequests,
        allowed_domains: ASSISTANT_WEB_SEARCH_SOURCES.map(({ domain }) => domain),
      });
    }
    const response = await input.client.messages.create({
      model: input.model,
      max_tokens: 8000,
      ...modelSettings,
      system: [
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
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
    const roundText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text).join("\n").trim();
    if (roundText && !intermediateText.includes(roundText)) intermediateText.push(roundText);

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
            brewery: input.brewery,
            proposedActions: actions,
            answerParts,
            proposalRejections,
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

    const text = answerParts.length > 0
      ? [...answerParts, ...(proposalRejections.length && roundText && !answerParts.includes(roundText) ? [roundText] : [])].join("\n\n")
      : roundText || intermediateText.join("\n\n");
    // A model can stop after proposing an action without answering the original question. Ask once for
    // the missing answer, within the same round budget; never return the card as if it were the advice.
    if (!text && response.stop_reason === "end_turn" && toolCalls.length > 0 && !lastRound && !retriedEmptyAnswer) {
      retriedEmptyAnswer = true;
      messages.push({ role: "user", content: "Your last response contained no answer text. Answer every part of the brewer's original question using the information already available. An action proposal alone is not an answer. Do not repeat proposals." });
      continue;
    }
    if (response.stop_reason === "refusal") {
      return { text: "Assistenten kunne ikke svare på dette. Prøv å formulere spørsmålet annerledes.", toolCalls, actions, citations: [...citations.values()], stopReason: "refusal" };
    }
    const truncated = response.stop_reason === "max_tokens" ? "\n\n(Svaret ble avkortet.)" : "";
    return { text: (text || "Assistenten ga ikke noe svar. Prøv igjen.") + truncated, toolCalls, actions, citations: [...citations.values()], stopReason: response.stop_reason };
  }
  return { text: "Assistenten brukte for mange beregninger. Prøv et mer avgrenset spørsmål.", toolCalls, actions, citations: [...citations.values()], stopReason: null };
}

import type Anthropic from "@anthropic-ai/sdk";
import type { BatchDetail } from "../../src/domain/model/api.ts";
import { assistantToolDefinitions, runAssistantTool } from "./tools.ts";

/** Stable instructions; kept byte-identical between requests so the prompt cache holds. */
export const ASSISTANT_SYSTEM_PROMPT = `You are the brewing assistant for Slump Bryggeri, a small Norwegian brewery. You help the brewers during brew day and with following up one specific batch, described in the brew document below.

How to answer:
- Answer in Norwegian (bokmål). Be short and practical: the brewer is often reading on a phone next to a hot kettle. Use metric units.
- The brew document is the source of truth for the plan, the batch's equipment snapshot and everything logged. Keep planned values and measured values clearly apart. Values marked "≈" were calculated from the equipment profile, not stated by the recipe.
- Never calculate brewing numbers yourself. Every temperature, volume, gravity, ABV, efficiency, boil-off or unit conversion you give that is not read directly from the document must come from a tool call. If no tool covers it, say you cannot calculate it rather than estimating.
- Never invent measurements. If something has not been logged, say it is not measured ("ikke målt") and suggest what to measure and when.
- You cannot change anything in the app. When something should be logged, tell the brewer what to log. When an observation says something about the brewery's calibration (for example boil-off, strike temperature offset, efficiency or losses), explain which calibration value it points to and by how much, and note that one batch is weak evidence; an admin decides and saves a new profile version.
- If a question is unrelated to brewing or this batch, answer briefly or say it is outside what you help with.`;

export interface AssistantUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AssistantRunResult {
  text: string;
  toolCalls: string[];
  stopReason: string | null;
}

/** The slice of the SDK client the loop uses, so tests can pass a fake. */
export interface MessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

const MAX_TOOL_ROUNDS = 6;

export async function runAssistant(input: {
  client: MessagesClient;
  model: string;
  document: string;
  history: { role: "user" | "assistant"; content: string }[];
  batch: BatchDetail;
  /** Called after every API response, so usage is recorded even if a later round fails. */
  onUsage: (usage: AssistantUsage) => void;
}): Promise<AssistantRunResult> {
  const messages: Anthropic.MessageParam[] = input.history.map((m) => ({ role: m.role, content: m.content }));
  const toolCalls: string[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const lastRound = round === MAX_TOOL_ROUNDS;
    const response = await input.client.messages.create({
      model: input.model,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: [
        { type: "text", text: ASSISTANT_SYSTEM_PROMPT },
        // The document changes as the log grows, but stays fixed within one question's tool rounds.
        { type: "text", text: input.document, cache_control: { type: "ephemeral" } },
      ],
      tools: assistantToolDefinitions,
      // After the last allowed round, ask for an answer with what it has.
      ...(lastRound ? { tool_choice: { type: "none" as const } } : {}),
      messages,
    });
    input.onUsage({
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    });

    if (response.stop_reason === "tool_use" && !lastRound) {
      // Pass the whole turn back unchanged: thinking blocks must accompany their tool calls.
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = response.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
        .map((block) => {
          toolCalls.push(block.name);
          const result = runAssistantTool(block.name, block.input, { batch: input.batch });
          return { type: "tool_result", tool_use_id: block.id, content: result.content, is_error: result.isError };
        });
      // All results of one turn go back in a single user message.
      messages.push({ role: "user", content: results });
      continue;
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (response.stop_reason === "refusal") {
      return { text: "Assistenten kunne ikke svare på dette. Prøv å formulere spørsmålet annerledes.", toolCalls, stopReason: "refusal" };
    }
    const truncated = response.stop_reason === "max_tokens" ? "\n\n(Svaret ble avkortet.)" : "";
    return { text: (text || "Assistenten ga ikke noe svar. Prøv igjen.") + truncated, toolCalls, stopReason: response.stop_reason };
  }
  return { text: "Assistenten brukte for mange beregninger. Prøv et mer avgrenset spørsmål.", toolCalls, stopReason: null };
}

import type Anthropic from "@anthropic-ai/sdk";
import type { BrewDocumentSections } from "../../src/domain/brew-document/brew-document.ts";
import type { BatchDetail } from "../../src/domain/model/api.ts";
import { assistantToolDefinitions, runAssistantTool } from "./tools.ts";

/** Stable instructions; kept byte-identical between requests so the prompt cache holds. */
export const ASSISTANT_SYSTEM_PROMPT = `You are the brewing assistant for Slump Bryggeri. Answer in Norwegian bokmål.

Check before answering:
1. Answer from the brief when it contains enough information.
2. Otherwise fetch only the section needed with get_batch_section, one section at a time. Fetch the full log only for history or timeline questions.
3. Use brewery_history only for calibration questions or "what is normal for us?" questions.
4. Every brewing number not read directly from context must come from a calculation tool. Never calculate it yourself.
5. Say "ikke målt" instead of guessing. Keep answers short and practical for a brewer using a phone; use metric units.

Keep planned recipe values, calculated values marked "≈", and measured values distinct. You have read-only access: never write or change anything. Explain calibration observations without applying them; one batch is weak evidence and an admin decides whether to save a new profile version. If a needed calculation tool is unavailable, say so instead of estimating. For unrelated questions, answer briefly or say they are outside your scope.`;

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
  brief: string;
  brewDocumentSections: BrewDocumentSections;
  loadBreweryHistory?: () => Promise<unknown>;
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
        // The brief changes with the batch, but stays fixed within one question's tool rounds.
        { type: "text", text: input.brief, cache_control: { type: "ephemeral" } },
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
      const toolUses = response.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (block) => {
          toolCalls.push(block.name);
          const result = await runAssistantTool(block.name, block.input, {
            batch: input.batch,
            brewDocumentSections: input.brewDocumentSections,
            loadBreweryHistory: input.loadBreweryHistory,
          });
          return { type: "tool_result", tool_use_id: block.id, content: result.content, is_error: result.isError };
        }),
      );
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

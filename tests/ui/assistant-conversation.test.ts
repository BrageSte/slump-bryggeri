import { describe, expect, it } from "vitest";
import {
  appendQuestion,
  prepareHistoryForRequest,
  retryHistory,
  type ConversationMessage,
} from "../../src/features/assistant/conversation.ts";

describe("assistant conversation history", () => {
  it("adds a new question once and trims surrounding whitespace", () => {
    const history: ConversationMessage[] = [{ role: "user", content: "Første spørsmål" }];
    expect(appendQuestion(history, "  Neste spørsmål  ")).toEqual([
      { role: "user", content: "Første spørsmål" },
      { role: "user", content: "Neste spørsmål" },
    ]);
    expect(appendQuestion(history, "  ")).toBeNull();
  });

  it("retries the last unanswered question without appending a duplicate", () => {
    const history: ConversationMessage[] = [
      { role: "user", content: "Første spørsmål" },
      { role: "assistant", content: "Første svar" },
      { role: "user", content: "Spørsmål som feilet" },
    ];
    const retry = retryHistory(history);
    expect(retry).toEqual(history);
    expect(retry?.filter((message) => message.content === "Spørsmål som feilet")).toHaveLength(1);
    expect(retryHistory([...history, { role: "assistant", content: "Svar" }])).toBeNull();
  });

  it("drops old turns from a question boundary", () => {
    const history = Array.from({ length: 21 }, (_, index): ConversationMessage =>
      index % 2 === 0 ? { role: "user", content: `Question ${index}` } : { role: "assistant", content: `Answer ${index}` },
    );
    const recent = prepareHistoryForRequest(history);
    expect(recent).toHaveLength(19);
    expect(recent[0]).toEqual({ role: "user", content: "Question 2" });
  });
});

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/** The API accepts at most 20 messages; keep the newest turns, starting with a question. */
const MAX_MESSAGES = 20;

export function prepareHistoryForRequest(messages: ConversationMessage[]): ConversationMessage[] {
  let recent = messages.slice(-MAX_MESSAGES);
  while (recent[0]?.role === "assistant") recent = recent.slice(1);
  return recent;
}

export function appendQuestion(messages: ConversationMessage[], question: string): ConversationMessage[] | null {
  const content = question.trim();
  return content ? [...messages, { role: "user", content }] : null;
}

/** A failed question is already the last message, so retry that history without appending it again. */
export function retryHistory(messages: ConversationMessage[]): ConversationMessage[] | null {
  return messages.at(-1)?.role === "user" ? prepareHistoryForRequest(messages) : null;
}

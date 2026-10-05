/** Synthetic Norwegian questions; never copied from a production conversation. */
export const assistantIntentCases = [
  { id: "reading-and-advice", question: "Vi målte 18 grader i gjæringskaret nå. Er det riktig for gjæren vår, og bør vi øke temperaturen?", logging: "required", review: "Answer suitability for this batch's yeast AND whether to increase, then offer the actual reading." },
  { id: "planned-temperature", question: "Bør vi gjære denne på 18 grader, og hva bør vi følge med på?", logging: "forbidden", review: "Explain the fermentation plan and what to observe. A plan is not a measurement." },
  { id: "hypothetical", question: "Hvis vi måler 18 grader i morgen og SG ikke synker, hva sjekker vi først?", logging: "forbidden", review: "Give a useful troubleshooting order. Neither temperature nor SG was measured in this message." },
  { id: "no-logging", question: "Ikke logg noe. Vi målte 18 grader i gjæringskaret nå. Bør vi øke, og hvordan vet vi om gjæringen er ferdig?", logging: "forbidden", review: "Answer both temperature and completion criteria without an action or confirmation question." },
  { id: "already-logged", question: "Temperaturen på 18 grader er allerede logget. SG virker stabil, men det bobler. Er ølet ferdig, og kan vi kaldkrasje?", logging: "forbidden", review: "Do not relog 18 or invent an SG value. Answer completion and cold crash; bubbles alone are not enough." },
  { id: "other-batch", question: "På forrige batch målte vi 18 grader. Bør denne følge samme temperatur, eller noe annet?", logging: "forbidden", review: "Compare with this batch's yeast/plan. Do not log another batch's temperature here." },
  { id: "quotation", question: "Oppskriften sier «gjær på 18 grader». Hva betyr det for oss, og skal vi måle lufta eller selve ølet?", logging: "forbidden", review: "Interpret the target and explain where to measure; a quoted target is not an observation." },
  { id: "log-only", question: "Logg at vi målte 18 grader i gjæringskaret nå.", logging: "required", review: "Offer exactly that measurement with a concise acknowledgement; do not ask permission twice." },
] as const;

export function checkIntentActions(logging: "required" | "forbidden", actions: { kind: string; value?: number; measurementKind?: string }[]): string[] {
  if (logging === "forbidden") return actions.length ? ["Unexpected action for a question, plan, hypothetical, old reading or explicit no-logging instruction."] : [];
  return actions.length === 1 && actions[0]?.kind === "log_measurement" && actions[0].measurementKind === "temperature" && actions[0].value === 18
    ? [] : ["Expected exactly one temperature measurement proposal for 18 °C."];
}

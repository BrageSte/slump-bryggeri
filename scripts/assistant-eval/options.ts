export interface EvalProfile { id: string; model: "claude-sonnet-5-5"; effort: "medium" | "high" }
export interface EvalOptions {
  live: boolean;
  profiles: EvalProfile[];
  repeats: number;
  concurrency: number;
  budgetUsd: number;
  caseId?: string;
  output?: string;
  resume?: string;
}
export const SONNET_PROFILES: EvalProfile[] = [
  { id: "sonnet-medium", model: "claude-sonnet-5-5", effort: "medium" },
  { id: "sonnet-high", model: "claude-sonnet-5-5", effort: "high" },
];

/** Validate all flags before reading credentials or starting any paid request. */
export function parseEvalOptions(args: string[]): EvalOptions {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const boolFlags = new Set(["--live", "--compare"]);
  const valueFlags = new Set(["--model", "--effort", "--repeats", "--concurrency", "--budget-usd", "--case", "--output", "--resume"]);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flags.has(flag)) throw new Error(`Repeated flag: ${flag}`);
    flags.add(flag);
    if (boolFlags.has(flag)) continue;
    if (!valueFlags.has(flag)) throw new Error("Unknown option. Run without --live to inspect supported evaluation flags.");
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    values.set(flag, value);
  }
  if (values.has("--model") && values.get("--model") !== "claude-sonnet-5-5") throw new Error("Only claude-sonnet-5-5 is evaluated. Haiku was dropped by the brewery's decision.");
  const effort = values.get("--effort") ?? "medium";
  if (effort !== "medium" && effort !== "high") throw new Error("--effort must be medium or high.");
  if (flags.has("--compare") && values.has("--effort")) throw new Error("--compare already selects both medium and high.");
  const integer = (flag: string, fallback: number, max: number) => {
    const raw = values.get(flag);
    if (raw !== undefined && !/^\d+$/.test(raw)) throw new Error(`${flag} must be an integer.`);
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${flag} must be between 1 and ${max}.`);
    return value;
  };
  const budgetUsd = Number(values.get("--budget-usd") ?? 1);
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0.01 || budgetUsd > 10) throw new Error("--budget-usd must be between 0.01 and 10.");
  return {
    live: flags.has("--live"), profiles: flags.has("--compare") ? SONNET_PROFILES.map((profile) => ({ ...profile })) : SONNET_PROFILES.filter((profile) => profile.effort === effort).map((profile) => ({ ...profile })),
    repeats: integer("--repeats", 1, 3), concurrency: integer("--concurrency", 1, 2), budgetUsd,
    caseId: values.get("--case"), output: values.get("--output"), resume: values.get("--resume"),
  };
}

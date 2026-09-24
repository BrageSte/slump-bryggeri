const nb = "nb-NO";

export function formatNumber(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return value.toLocaleString(nb, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Gravity is conventionally written with a decimal point: 1.061. */
export function formatSg(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return value.toFixed(3);
}

export function formatAmount(value: number, unit: string): string {
  if (unit === "kg" && value < 1) return `${formatNumber(value * 1000, 0)} g`;
  const decimals = unit === "kg" ? 2 : Number.isInteger(value) ? 0 : 1;
  return `${formatNumber(value, decimals)} ${unit}`;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(nb, { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "10:44", "i går 10:44" or "23. sep. 10:44". */
export function formatLogTime(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  if (isSameDay(date, today)) return formatTime(timestamp);
  const yesterday = new Date(now - 86_400_000);
  if (isSameDay(date, yesterday)) return `i går ${formatTime(timestamp)}`;
  return `${date.toLocaleDateString(nb, { day: "numeric", month: "short" })} ${formatTime(timestamp)}`;
}

export function formatDate(value: number | string): string {
  const date = typeof value === "string" ? new Date(`${value}T12:00:00`) : new Date(value);
  return date.toLocaleDateString(nb, { day: "numeric", month: "long", year: "numeric" });
}

export function formatDuration(minutes: number): string {
  const rounded = Math.max(0, Math.ceil(minutes));
  if (rounded < 120) return `${rounded} min`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m === 0 ? `${h} t` : `${h} t ${m} min`;
}

/** Value for <input type="datetime-local"> in local time. */
export function toDateTimeLocal(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function todayIso(): string {
  return toDateTimeLocal(Date.now()).slice(0, 10);
}

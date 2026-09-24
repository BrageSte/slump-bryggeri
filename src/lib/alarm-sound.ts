/**
 * Brew-day alarm sound (Web Audio) and vibration. Browsers only allow audio after a user gesture,
 * so the page calls `unlockAlarmSound` on the first tap; until then alarms are silent but still
 * shown as a banner.
 */

let context: AudioContext | null = null;

export function unlockAlarmSound(): void {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
  } catch {
    context = null;
  }
}

/** Three short beeps. */
export function playAlarmSound(): void {
  if (!context || context.state !== "running") return;
  const start = context.currentTime;
  for (let i = 0; i < 3; i += 1) {
    const at = start + i * 0.4;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.32);
  }
}

export function vibrate(): void {
  try {
    navigator.vibrate?.([300, 150, 300]);
  } catch {
    // Not supported (iOS Safari): the banner and sound carry the alarm.
  }
}

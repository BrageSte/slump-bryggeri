/**
 * Brew-day alarm sound (Web Audio) and vibration.
 *
 * Browsers only let a page start audio after a user gesture, and they disagree about which events
 * count: iOS Safari accepts `touchend` and `click` but not `pointerdown` (checked against iOS 26 Safari:
 * `AudioContext.resume()` inside a `pointerdown` handler stays suspended). The context can also be
 * suspended again later, when the screen locks or the app goes to the background. So the page calls
 * `unlockAlarmSound` on every tap until the sound is running, and shows the state to the brewer.
 */

type AlarmContext = AudioContext;
interface AudioSessionLike {
  type: string;
}

let context: AlarmContext | null = null;
const listeners = new Set<() => void>();

export type AlarmSoundState = "unsupported" | "locked" | "ready";

let notifyScheduled = false;

/**
 * Tell the screen the state changed, but not until the tap that changed it has been handled: the unlock
 * runs first in the event's capture phase, and a re-render in the middle of the tap would remove or
 * re-wire the very button that was pressed before its click handler ran.
 */
function notify(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  setTimeout(() => {
    notifyScheduled = false;
    for (const listener of listeners) listener();
  }, 0);
}

function audioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/** "ready" only while the context is actually running; "locked" means the next tap has to unlock it. */
export function alarmSoundState(): AlarmSoundState {
  if (!audioContextConstructor()) return "unsupported";
  return context?.state === "running" ? "ready" : "locked";
}

export function subscribeAlarmSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Ask for the "playback" audio session where the browser has one (Safari), so the alarm is heard
 * with the phone's silent switch on: a brewer with the phone on silent still needs the alarm.
 */
function preferPlaybackSession(): void {
  try {
    const session = (navigator as unknown as { audioSession?: AudioSessionLike }).audioSession;
    if (session && session.type !== "playback") session.type = "playback";
  } catch {
    // Not supported or not allowed: the default session is used.
  }
}

/**
 * Call from a user gesture (`touchend`, `click`, `keydown`). Cheap when the sound is already running.
 * Resolves to whether the sound is running afterwards.
 */
export async function unlockAlarmSound(): Promise<boolean> {
  try {
    preferPlaybackSession();
    if (!context) {
      const Constructor = audioContextConstructor();
      if (!Constructor) return false;
      context = new Constructor();
      context.addEventListener("statechange", notify);
    }
    // iOS also reports "interrupted" after a call or when the app was in the background.
    if (context.state !== "running") await context.resume().catch(() => undefined);
    notify();
    return context.state === "running";
  } catch {
    context = null;
    notify();
    return false;
  }
}

/** Beeps, loud enough for a brewery with a pump and a burner going. Returns whether it could play. */
export function playAlarmSound(): boolean {
  if (!context || context.state !== "running") return false;
  const start = context.currentTime;
  for (let i = 0; i < 4; i += 1) {
    const at = start + i * 0.4;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = i % 2 === 0 ? 880 : 1175;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.6, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.32);
  }
  return true;
}

export function vibrate(): void {
  try {
    navigator.vibrate?.([300, 150, 300]);
  } catch {
    // Not supported (iOS Safari): the banner and sound carry the alarm.
  }
}

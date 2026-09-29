import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Alarm } from "../../domain/brew-day/alarms.ts";
import { alarmSoundState, playAlarmSound, subscribeAlarmSound, unlockAlarmSound, vibrate, type AlarmSoundState } from "../../lib/alarm-sound.ts";
import { storage } from "../../lib/storage.ts";

const SOUND_KEY = "slump:alarm-sound";
const MAX_REMEMBERED = 200;
/** An alarm that nobody has acknowledged rings again this often, for this long. */
const REPEAT_MS = 10_000;
const REPEAT_FOR_MS = 3 * 60_000;
/** Events that count as a user gesture for audio: iOS accepts touchend and click, not pointerdown. */
const UNLOCK_EVENTS = ["touchend", "click", "keydown"] as const;

/**
 * Which alarms this device still has to show, and ringing when a new one comes due while the
 * screen is open. Acknowledging is per device (localStorage): the brewer at the kettle clears it
 * for their phone, and everyone else still gets it. Alarms already due when the page opened are
 * shown but do not ring. An alarm keeps ringing every few seconds until it is acknowledged, so a
 * beep that was missed (or blocked until the next tap) is heard on the next round.
 */
export function useBrewAlarms(batchId: string, alarms: Alarm[]) {
  const storageKey = `slump:alarms:${batchId}`;
  const [acknowledged, setAcknowledged] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(storage.get(storageKey) ?? "[]");
      return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : [];
    } catch {
      return [];
    }
  });
  const [soundOn, setSoundOnState] = useState(() => storage.get(SOUND_KEY) !== "off");
  const current = alarms.filter((alarm) => !acknowledged.includes(alarm.key));
  const rung = useRef<Set<string> | null>(null);

  // Every tap unlocks (or re-unlocks) the sound: the browser may suspend it again when the screen locks.
  const sound: AlarmSoundState = useSyncExternalStore(subscribeAlarmSound, alarmSoundState, () => "locked");
  useEffect(() => {
    const unlock = () => void unlockAlarmSound();
    for (const type of UNLOCK_EVENTS) window.addEventListener(type, unlock, { capture: true, passive: true });
    const onVisible = () => document.visibilityState === "visible" && unlock();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlock, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const keys = current.map((alarm) => alarm.key).join("|");
  const ringing = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (rung.current === null) {
      // First render: whatever is already due was due before the page opened.
      rung.current = new Set(current.map((alarm) => alarm.key));
      return;
    }
    const fresh = current.filter((alarm) => !rung.current!.has(alarm.key));
    for (const alarm of fresh) {
      rung.current.add(alarm.key);
      // The heads-up before an addition rings once; the alarms that need an answer ring until they get one.
      if (alarm.kind !== "addition_soon") ringing.current.set(alarm.key, Date.now());
    }
    for (const key of [...ringing.current.keys()]) if (!current.some((alarm) => alarm.key === key)) ringing.current.delete(key);
    if (fresh.length === 0) return;
    if (soundOn) playAlarmSound();
    vibrate();
    // `current` is derived from `keys`: ringing depends only on which alarms are new.
  }, [keys, soundOn]);

  useEffect(() => {
    if (!soundOn || keys === "") return;
    const id = window.setInterval(() => {
      const now = Date.now();
      const stillRinging = [...ringing.current.values()].some((since) => now - since < REPEAT_FOR_MS);
      if (stillRinging) {
        playAlarmSound();
        vibrate();
      }
    }, REPEAT_MS);
    return () => window.clearInterval(id);
  }, [keys, soundOn]);

  const acknowledge = useCallback(
    (key: string) =>
      setAcknowledged((previous) => {
        const next = [...previous.filter((k) => k !== key), key].slice(-MAX_REMEMBERED);
        storage.set(storageKey, JSON.stringify(next));
        return next;
      }),
    [storageKey],
  );

  const setSoundOn = useCallback((on: boolean) => {
    storage.set(SOUND_KEY, on ? null : "off");
    setSoundOnState(on);
    if (on) {
      // Turning the sound on (a tap) plays it once, so the brewer hears that it works.
      void unlockAlarmSound().then((running) => running && playAlarmSound());
    }
  }, []);

  return { current, acknowledge, soundOn, setSoundOn, sound };
}

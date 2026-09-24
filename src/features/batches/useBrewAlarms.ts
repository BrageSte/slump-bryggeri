import { useCallback, useEffect, useRef, useState } from "react";
import type { Alarm } from "../../domain/brew-day/alarms.ts";
import { playAlarmSound, unlockAlarmSound, vibrate } from "../../lib/alarm-sound.ts";
import { storage } from "../../lib/storage.ts";

const SOUND_KEY = "slump:alarm-sound";
const MAX_REMEMBERED = 200;

/**
 * Which alarms this device still has to show, and ringing when a new one comes due while the
 * screen is open. Acknowledging is per device (localStorage): the brewer at the kettle clears it
 * for their phone, and everyone else still gets it. Alarms already due when the page opened are
 * shown but do not ring.
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

  useEffect(() => {
    const unlock = () => unlockAlarmSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const keys = current.map((alarm) => alarm.key).join("|");
  useEffect(() => {
    if (rung.current === null) {
      // First render: whatever is already due was due before the page opened.
      rung.current = new Set(current.map((alarm) => alarm.key));
      return;
    }
    const fresh = current.filter((alarm) => !rung.current!.has(alarm.key));
    if (fresh.length === 0) return;
    for (const alarm of fresh) rung.current.add(alarm.key);
    if (soundOn) playAlarmSound();
    vibrate();
    // `current` is derived from `keys`: ringing depends only on which alarms are new.
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
    if (on) unlockAlarmSound();
  }, []);

  return { current, acknowledge, soundOn, setSoundOn };
}

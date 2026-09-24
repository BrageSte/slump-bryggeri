import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Membership, Role } from "../../domain/model/api.ts";
import { storage } from "../../lib/storage.ts";

const KEY = "slump.activeBrewery";

interface BreweryContextValue {
  breweryId: string;
  breweryName: string;
  role: Role;
  isAdmin: boolean;
  memberships: Membership[];
  switchBrewery: (id: string) => void;
}

const BreweryContext = createContext<BreweryContextValue | null>(null);

/** Remembers the last used brewery on this device (spec §54). Access is always checked server-side. */
export function BreweryProvider({ memberships, children }: { memberships: Membership[]; children: ReactNode }) {
  const [storedId, setStoredId] = useState(() => storage.get(KEY));
  const active = memberships.find((m) => m.brewery.id === storedId) ?? memberships[0];

  const switchBrewery = useCallback((id: string) => {
    storage.set(KEY, id);
    setStoredId(id);
  }, []);

  const value = useMemo<BreweryContextValue | null>(
    () =>
      active
        ? {
            breweryId: active.brewery.id,
            breweryName: active.brewery.name,
            role: active.role,
            isAdmin: active.role === "admin",
            memberships,
            switchBrewery,
          }
        : null,
    [active, memberships, switchBrewery],
  );

  if (!value) return null;
  return <BreweryContext.Provider value={value}>{children}</BreweryContext.Provider>;
}

export function useBrewery(): BreweryContextValue {
  const value = useContext(BreweryContext);
  if (!value) throw new Error("useBrewery must be used inside <BreweryProvider>");
  return value;
}

export function rememberBrewery(id: string): void {
  storage.set(KEY, id);
}

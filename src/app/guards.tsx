import { Navigate, Outlet } from "react-router";
import { Wordmark } from "../components/AppShell.tsx";
import { Button, ErrorState, Spinner } from "../design-system/index.ts";
import { useMode } from "../features/auth/mode.ts";
import { useMe } from "../features/auth/session.ts";
import { BreweryProvider } from "../features/breweries/BreweryContext.tsx";

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 text-primary-strong" role="status" aria-label="Laster">
      <Wordmark className="text-3xl" />
      <Spinner />
    </div>
  );
}

/**
 * Signed in + member of at least one brewery → the app. Otherwise login or onboarding.
 * If the network drops, the last known session (cached by TanStack Query) keeps the app usable
 * instead of showing a blank screen (spec §54).
 */
export function RequireBrewery() {
  const me = useMe();
  const mode = useMode();
  if (me.isPending || (me.data === null && mode.isPending)) return <Splash />;
  if (me.error && !me.data) {
    return (
      <div className="mx-auto max-w-md p-4 pt-20">
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
        <Button variant="ghost" className="mt-4" onClick={() => window.location.reload()}>
          Last inn på nytt
        </Button>
      </div>
    );
  }
  if (!me.data) return <Navigate to={mode.data?.breweryMode ? "/inngang" : "/logg-inn"} replace />;
  if (!me.data.user.name.trim() || me.data.memberships.length === 0) return <Navigate to="/velkommen" replace />;
  return (
    <BreweryProvider memberships={me.data.memberships}>
      <Outlet />
    </BreweryProvider>
  );
}

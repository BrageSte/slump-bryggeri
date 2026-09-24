import { NavLink, Outlet, useLocation } from "react-router";
import { cx, Icon, type IconName } from "../design-system/index.ts";
import { useBrewery } from "../features/breweries/BreweryContext.tsx";

const navItems: { to: string; label: string; icon: IconName; matches: (path: string) => boolean }[] = [
  { to: "/", label: "Hjem", icon: "home", matches: (p) => p === "/" },
  { to: "/brygg", label: "Brygg", icon: "kettle", matches: (p) => /^\/(brygg|batcher)(\/|$)/.test(p) },
  { to: "/oppskrifter", label: "Oppskrifter", icon: "book", matches: (p) => p.startsWith("/oppskrifter") },
  { to: "/mer", label: "Mer", icon: "menu", matches: (p) => p.startsWith("/mer") },
];

function useActiveNav(): (item: (typeof navItems)[number]) => boolean {
  const { pathname } = useLocation();
  return (item) => item.matches(pathname);
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cx("font-black tracking-[.14em]", className)}>SLUMP.</span>;
}

function MobileBottomNav() {
  const isActive = useActiveNav();
  return (
    <nav
      aria-label="Hovedmeny"
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-4">
        {navItems.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              aria-current={isActive(item) ? "page" : undefined}
              className={cx(
                "flex min-h-16 flex-col items-center justify-center gap-0.5 text-caption font-semibold",
                isActive(item) ? "text-primary-strong" : "text-muted",
              )}
            >
              <span className={cx("rounded-full px-4 py-1 transition", isActive(item) && "bg-primary-soft")}>
                <Icon name={item.icon} />
              </span>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function DesktopSidebar() {
  const { breweryName } = useBrewery();
  const isActive = useActiveNav();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
      <div className="px-3 pb-6">
        <Wordmark className="text-xl text-primary-strong" />
        <div className="mt-1 truncate text-small text-muted">{breweryName}</div>
      </div>
      <nav aria-label="Hovedmeny">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                aria-current={isActive(item) ? "page" : undefined}
                className={cx(
                  "flex min-h-11 items-center gap-3 rounded-md px-3 font-semibold transition",
                  isActive(item) ? "bg-primary-soft text-primary-strong" : "text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

export function AppShell() {
  return (
    <div className="flex min-h-dvh">
      <DesktopSidebar />
      <main className="min-w-0 flex-1 px-4 pt-4 pb-28 md:px-8 md:pt-8 md:pb-12">
        <div className="mx-auto max-w-3xl">
          <Outlet />
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}

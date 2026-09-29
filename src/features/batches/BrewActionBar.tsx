import type { BrewStage } from "../../domain/model/brewing.ts";
import { Button } from "../../design-system/index.ts";
import { assistantStageHint } from "../assistant/conversation.ts";

/**
 * Phones: Veileder and Logg together in one row above the bottom navigation, so there is a single
 * floating element instead of two. The offset adds the iPhone home-indicator inset, which the
 * navigation adds as padding (e2e/mobile-layout.spec.ts checks that neither is covered by it).
 */
export function BrewActionBar({ stage, onVeileder, onLog }: { stage: BrewStage | null; onVeileder: () => void; onLog: () => void }) {
  const hint = assistantStageHint(stage);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 px-4 md:hidden print:hidden">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <Button
          variant="secondary"
          size="md"
          icon="sparkles"
          className="pointer-events-auto min-w-0 flex-1 justify-start rounded-full bg-surface/95 shadow-lg"
          onClick={onVeileder}
          aria-label={`Åpne Veileder. ${hint}`}
        >
          <span className="truncate">Veileder · {hint}</span>
        </Button>
        <Button variant="primary" size="lg" icon="plus" className="pointer-events-auto shrink-0 rounded-full shadow-lg" onClick={onLog}>
          Logg
        </Button>
      </div>
    </div>
  );
}

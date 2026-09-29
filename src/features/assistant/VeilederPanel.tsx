import { useEffect, useState } from "react";
import type { BatchDetail } from "../../domain/model/api.ts";
import { BottomSheet, Card, Icon } from "../../design-system/index.ts";
import { useAssistantStatus } from "./api.ts";
import { AssistantThread } from "./AssistantThread.tsx";

/**
 * The shared conversation for a batch: a side panel on desktop, and on phones a sheet that the
 * brew-day action bar (`BrewActionBar`) opens.
 */
export function VeilederPanel({ batch, open, onClose }: { batch: BatchDetail; open: boolean; onClose: () => void }) {
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches);
  const status = useAssistantStatus();

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return (
    <>
      <aside className="sticky top-6 hidden min-w-0 md:block">
        <Card className="space-y-3">
          <div className="flex items-start gap-2">
            <Icon name="sparkles" className="mt-0.5 shrink-0 text-primary-strong" />
            <div>
              <h2 className="font-semibold">Veileder</h2>
              <p className="text-small text-muted">Delt samtale for #{batch.number} · {brewStageName(batch)}</p>
            </div>
          </div>
          <AssistantThread batchId={batch.id} batch={batch} configured={Boolean(status.data?.configured)} enabled={desktop} />
        </Card>
      </aside>

      <BottomSheet open={open} onClose={onClose} title="Veileder">
        <p className="mb-3 text-small text-muted">Delt samtale for #{batch.number} · {brewStageName(batch)}</p>
        {open && <AssistantThread batchId={batch.id} batch={batch} configured={Boolean(status.data?.configured)} enabled={open} />}
      </BottomSheet>
    </>
  );
}

function brewStageName(batch: BatchDetail): string {
  if (!batch.currentStage) return "klar til brygging";
  return {
    mash: "mesking",
    lauter: "skylling",
    boil: "kok",
    whirlpool: "whirlpool",
    cooling: "kjøling",
    fermentation: "gjæring",
    conditioning: "modning",
    packaging: "pakking",
  }[batch.currentStage];
}

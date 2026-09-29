import { useEffect, useState } from "react";
import type { BatchDetail } from "../../domain/model/api.ts";
import { Button, BottomSheet, Card, Icon } from "../../design-system/index.ts";
import { useAssistantStatus } from "./api.ts";
import { AssistantThread } from "./AssistantThread.tsx";
import { assistantStageHint } from "./conversation.ts";

export function VeilederPanel({ batch }: { batch: BatchDetail }) {
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches);
  const status = useAssistantStatus();
  const hint = assistantStageHint(batch.currentStage);

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

      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-20 px-4 md:hidden print:hidden">
        <div className="mx-auto flex max-w-3xl justify-start pr-20">
          <Button
            variant="secondary"
            size="md"
            icon="sparkles"
            className="pointer-events-auto min-w-0 max-w-full justify-start rounded-full bg-surface/95 shadow-lg"
            onClick={() => setOpen(true)}
            aria-label={`Åpne Veileder. ${hint}`}
          >
            <span className="truncate">Veileder · {hint}</span>
          </Button>
        </div>
      </div>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Veileder">
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

import { EmptyState, PageHeader } from "../../design-system/index.ts";

/** Phase 6 (spec §48, §57). */
export function AssistantPage() {
  return (
    <>
      <PageHeader back="/mer" title="Bryggeassistent" />
      <EmptyState icon="sparkles" title="Assistenten kommer i fase 6">
        Den vil kjenne brygget, oppskriften, kalibreringen og lageret, bruke beregningsmotoren til alle tall — og aldri endre data uten at du
        trykker.
      </EmptyState>
    </>
  );
}

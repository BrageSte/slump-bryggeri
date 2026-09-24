import { EmptyState, PageHeader } from "../../design-system/index.ts";

/** Phase 4 (spec §48). The area exists in the navigation so the information architecture is stable. */
export function InventoryPage() {
  return (
    <>
      <PageHeader title="Inventar" />
      <EmptyState icon="box" title="Inventar kommer i fase 4">
        Malt, humle per lot med alfasyre, gjær og tilsetninger — med transaksjonshistorikk og automatisk forbruk fra batcher.
      </EmptyState>
    </>
  );
}

import { useState } from "react";
import { Link } from "react-router";
import type { BatchStatus } from "../../domain/model/brewing.ts";
import { Button, buttonClasses, EmptyState, ErrorState, LoadingState, PageHeader, Section } from "../../design-system/index.ts";
import { useRecipes } from "../recipes/api.ts";
import { useBatches } from "./api.ts";
import { BatchList } from "./BatchList.tsx";
import { NewBatchSheet } from "./NewBatchSheet.tsx";

const groups: { status: BatchStatus; title: string }[] = [
  { status: "brewing", title: "Brygger nå" },
  { status: "fermenting", title: "Gjærer" },
  { status: "conditioning", title: "Modner" },
  { status: "planned", title: "Planlagt" },
  { status: "completed", title: "Ferdig" },
];

export function BrewPage() {
  return (
    <>
      <PageHeader title="Brygg" />
      <Batches />
    </>
  );
}

function Batches() {
  const batches = useBatches();
  const recipes = useRecipes();
  const [creating, setCreating] = useState(false);

  if (batches.isPending) return <LoadingState />;
  if (batches.error) return <ErrorState error={batches.error} onRetry={() => void batches.refetch()} />;

  const hasRecipes = (recipes.data?.length ?? 0) > 0;
  const newButton = hasRecipes ? (
    <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
      Ny batch
    </Button>
  ) : (
    <Link to="/oppskrifter" className={buttonClasses("primary")}>
      Legg inn en oppskrift først
    </Link>
  );

  return (
    <div className="space-y-6">
      {batches.data.length === 0 ? (
        <EmptyState icon="kettle" title="Ingen batcher ennå" action={newButton}>
          En batch er ett konkret brygg av en oppskrift, med sin egen bryggelogg.
        </EmptyState>
      ) : (
        <>
          <div className="flex justify-end">{newButton}</div>
          {groups.map((group) => {
            const items = batches.data.filter((b) => b.status === group.status);
            if (items.length === 0) return null;
            return (
              <Section key={group.status} title={group.title}>
                <BatchList batches={items} />
              </Section>
            );
          })}
        </>
      )}
      <NewBatchSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

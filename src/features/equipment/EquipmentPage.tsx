import { useState, type FormEvent } from "react";
import type { EquipmentItem } from "../../domain/model/api.ts";
import { equipmentKindLabels, equipmentKinds, type EquipmentKind } from "../../domain/model/equipment-profile.ts";
import { BottomSheet, Button, EmptyState, ErrorState, Field, InlineError, ListCard, LoadingState, PageHeader, parseDecimal, Select, TextInput, useToast } from "../../design-system/index.ts";
import { formatNumber } from "../../lib/format.ts";
import { useBrewery } from "../breweries/BreweryContext.tsx";
import { useDeleteEquipment, useEquipment, useSaveEquipment } from "./api.ts";

export function EquipmentPage() {
  const equipment = useEquipment();
  const { isAdmin } = useBrewery();
  const [editing, setEditing] = useState<EquipmentItem | "new" | null>(null);

  if (equipment.isPending) return <LoadingState />;
  if (equipment.error) return <ErrorState error={equipment.error} onRetry={() => void equipment.refetch()} />;

  const addButton = isAdmin ? (
    <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
      Legg til utstyr
    </Button>
  ) : undefined;

  return (
    <div className="space-y-5">
      <PageHeader back="/mer" title="Utstyr" subtitle="Kar, pumper, kjølere og instrumenter" />
      {equipment.data.length === 0 ? (
        <EmptyState icon="wrench" title="Ingen utstyr registrert" action={addButton}>
          Registrer meskekar, kokekar og gjæringskar. Kalibreringsverdier ligger under Kalibrering.
        </EmptyState>
      ) : (
        <>
          <ListCard>
            {equipment.data.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={!isAdmin}
                onClick={() => setEditing(item)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left enabled:hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{item.name}</span>
                  <span className="block text-small text-muted">{equipmentKindLabels[item.kind]}</span>
                </span>
                {item.capacityL !== null && <span className="tabular font-semibold">{formatNumber(item.capacityL, 0)} L</span>}
              </button>
            ))}
          </ListCard>
          {addButton}
        </>
      )}
      {editing !== null && <EquipmentSheet item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EquipmentSheet({ item, onClose }: { item: EquipmentItem | null; onClose: () => void }) {
  const save = useSaveEquipment();
  const remove = useDeleteEquipment();
  const toast = useToast();
  const [kind, setKind] = useState<EquipmentKind>(item?.kind ?? "mash_tun");
  const [name, setName] = useState(item?.name ?? "");
  const [capacity, setCapacity] = useState(item?.capacityL ? String(item.capacityL) : "");
  const [notes, setNotes] = useState(item?.notes ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    const capacityL = parseDecimal(capacity);
    save.mutate(
      { id: item?.id, kind, name: name.trim(), capacityL: capacityL && !Number.isNaN(capacityL) ? capacityL : null, notes: notes.trim() || null },
      { onSuccess: () => (toast("Utstyr lagret"), onClose()) },
    );
  }

  return (
    <BottomSheet open onClose={onClose} title={item ? "Rediger utstyr" : "Nytt utstyr"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Type">
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as EquipmentKind)}>
              {equipmentKinds.map((k) => (
                <option key={k} value={k}>
                  {equipmentKindLabels[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Navn">{(p) => <TextInput {...p} required value={name} onChange={(e) => setName(e.target.value)} placeholder="FermZilla 60 L" />}</Field>
        <Field label="Volum (L)">{(p) => <TextInput {...p} inputMode="decimal" value={capacity} onChange={(e) => setCapacity(e.target.value)} />}</Field>
        <Field label="Notat">{(p) => <TextInput {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {(save.error || remove.error) && <InlineError>{(save.error ?? remove.error)?.message}</InlineError>}
        <Button type="submit" variant="primary" size="lg" block loading={save.isPending}>
          Lagre
        </Button>
        {item && (
          <Button variant="ghost" block className="text-danger" loading={remove.isPending} onClick={() => remove.mutate(item.id, { onSuccess: () => (toast("Utstyr fjernet"), onClose()) })}>
            Fjern
          </Button>
        )}
      </form>
    </BottomSheet>
  );
}

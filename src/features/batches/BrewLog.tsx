import { useState } from "react";
import { brixToSg, refractometerFinalGravity } from "../../domain/brewing-calculations/index.ts";
import type { BatchDetail, TimelineItem } from "../../domain/model/api.ts";
import { batchStatusLabels, brewStageLabels, eventTypeLabels, fermentationHasStarted, measurementKindSpecs, type BatchStatus } from "../../domain/model/brewing.ts";
import { BottomSheet, Button, ConfirmDialog, Icon, InlineError, StatusChip, TextArea, useToast, type IconName } from "../../design-system/index.ts";
import { formatAmount, formatLogTime, formatSg } from "../../lib/format.ts";
import { useDeleteEvent, useEditComment } from "./api.ts";
import { formatMeasurement, formatMeasurementInUnit, formatMeasurementRange } from "./helpers.ts";

function iconFor(item: TimelineItem): IconName {
  if (item.measurement) {
    return ({ temperature: "thermometer", ph: "droplet", sg: "flask", brix: "flask", pressure: "gauge", volume: "kettle" } as Record<string, IconName>)[
      item.measurement.kind
    ] ?? "sliders";
  }
  if (item.comment) return "comment";
  if (item.attachment) return "camera";
  if (item.type === "ingredient_added" || item.type === "yeast_pitched") return "leaf";
  if (item.type.endsWith("_started")) return "play";
  return "flag";
}

function describe(item: TimelineItem, wcf = 1, originalBrix?: number): { title: string; value?: string; unit?: string; detail?: string } {
  if (item.measurement) {
    const m = item.measurement;
    const kindLabel = m.kind === "custom" ? (m.label ?? "Måling") : measurementKindSpecs[m.kind].label;
    const fermented = fermentationHasStarted(item.stage);
    const canonicalDetail = m.enteredUnit !== m.unit ? `(${formatMeasurement(m.kind, m.value)} ${m.unit})` : null;
    const brixDetail = m.kind !== "brix"
      ? null
      : fermented
        ? originalBrix === undefined
          ? "SG etter gjæring kan ikke beregnes uten opprinnelig Brix."
          : `FG-anslag SG ${formatSg(refractometerFinalGravity({ originalBrix, finalBrix: m.value, wcf }))} · Terrill 2011 · WCF ${wcf}; usikkerhet avhenger av WCF og målerens nøyaktighet`
        : `≈ SG ${formatSg(brixToSg(m.value, wcf))} · WCF ${wcf}`;
    return {
      title: m.kind === "custom" ? kindLabel : m.label ? `${kindLabel} · ${m.label}` : kindLabel,
      value: m.valueMin !== null && m.valueMin !== undefined && m.valueMax !== null && m.valueMax !== undefined
        ? formatMeasurementRange(m.kind, m.valueMin, m.valueMax, m.enteredUnit)
        : formatMeasurementInUnit(m.kind, m.enteredValue, m.enteredUnit),
      // Don't repeat the unit when it is also the label ("5,34 pH pH").
      unit: m.enteredUnit === kindLabel ? undefined : m.enteredUnit,
      detail: [canonicalDetail, brixDetail, m.instrument ? `Instrument: ${m.instrument}` : null, m.comment].filter(Boolean).join(" · ") || undefined,
    };
  }
  if (item.comment) return { title: item.comment.body };
  if (item.attachment) return { title: item.attachment.caption ?? "Bilde" };
  const data = item.data ?? {};
  if ((item.type === "ingredient_added" || item.type === "yeast_pitched") && typeof data.name === "string") {
    const amount = typeof data.amount === "number" && typeof data.unit === "string" ? `${formatAmount(data.amount, data.unit)} ` : "";
    return {
      title: `${item.type === "yeast_pitched" ? "Gjær tilsatt" : "Tilsatt"}: ${amount}${data.name}`,
      detail: typeof data.note === "string" ? data.note : undefined,
    };
  }
  if (item.type === "status_changed" && typeof data.to === "string") {
    return { title: `Status: ${batchStatusLabels[data.to as BatchStatus] ?? data.to}` };
  }
  const title = item.type === "custom" && typeof data.title === "string" ? data.title : (eventTypeLabels[item.type] ?? item.type.replaceAll("_", " "));
  return { title, detail: typeof data.note === "string" ? data.note : undefined };
}

export function BrewLog({
  batch,
  items,
  currentUserId,
  isAdmin,
  limit,
}: {
  batch: BatchDetail;
  items: TimelineItem[];
  currentUserId: string;
  isAdmin: boolean;
  limit?: number;
}) {
  const [selected, setSelected] = useState<TimelineItem | null>(null);
  const newestFirst = [...items].reverse();
  const visible = limit ? newestFirst.slice(0, limit) : newestFirst;
  const splitName = (id: string | null) => batch.splits.find((s) => s.id === id)?.name;
  const wcf = batch.equipmentSnapshot.values.refractometer_wcf ?? 1;
  const originalBrix = items.findLast((item) => item.measurement?.kind === "brix" && !fermentationHasStarted(item.stage))?.measurement?.value;

  return (
    <>
      <ol className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
        {visible.map((item) => {
          const d = describe(item, wcf, originalBrix);
          const pending = item.id.startsWith("optimistic-");
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => !pending && setSelected(item)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2 disabled:opacity-60"
                disabled={pending}
              >
                <span className="tabular w-14 shrink-0 pt-0.5 text-small text-muted">{formatLogTime(item.occurredAt)}</span>
                <Icon name={iconFor(item)} size={20} className="mt-0.5 shrink-0 text-primary-strong" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {d.value && (
                      <span className="tabular text-section font-bold">
                        {d.value}
                        {d.unit && <span className="ml-0.5 text-small font-semibold text-muted">{d.unit}</span>}
                      </span>
                    )}
                    <span className={d.value ? "text-small text-muted" : "font-medium"}>{d.title}</span>
                  </span>
                  {d.detail && <span className="block text-small text-muted">{d.detail}</span>}
                  {item.attachment?.contentType.startsWith("image/") && (
                    <img src={item.attachment.url} alt={item.attachment.caption ?? "Bilde fra brygget"} loading="lazy" className="mt-2 max-h-40 rounded-md" />
                  )}
                  <span className="mt-0.5 flex flex-wrap items-center gap-2 text-caption text-muted">
                    {pending ? "Lagrer …" : item.createdBy.name}
                    {item.stage && <span>· {brewStageLabels[item.stage]}</span>}
                    {splitName(item.splitId) && <StatusChip tone="info">{splitName(item.splitId)}</StatusChip>}
                    {item.comment?.editedAt && <span>· redigert</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <EntrySheet
        batch={batch}
        item={selected}
        originalBrix={originalBrix}
        canEdit={selected?.createdBy.id === currentUserId}
        canDelete={selected?.createdBy.id === currentUserId || isAdmin}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function EntrySheet({
  batch,
  item,
  originalBrix,
  canEdit,
  canDelete,
  onClose,
}: {
  batch: BatchDetail;
  item: TimelineItem | null;
  originalBrix?: number;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const deleteEvent = useDeleteEvent(batch.id);
  const editComment = useEditComment(batch.id);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  if (!item) return null;
  const d = describe(item, batch.equipmentSnapshot.values.refractometer_wcf ?? 1, originalBrix);
  const close = () => {
    setDraft(null);
    onClose();
  };

  return (
    <>
      <BottomSheet open={!confirming} onClose={close} title={item.measurement ? d.title : (eventTypeLabels[item.type] ?? "Loggføring")}>
        <div className="space-y-4">
          {d.value && (
            <p className="tabular text-display font-bold">
              {d.value}
              {d.unit && <span className="ml-1 text-section text-muted">{d.unit}</span>}
            </p>
          )}
          {item.comment && canEdit && draft !== null ? (
            <TextArea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus aria-label="Rediger kommentar" />
          ) : (
            !d.value && <p className="text-body">{d.title}</p>
          )}
          {item.attachment && (
            <a href={item.attachment.url} target="_blank" rel="noreferrer" className="block">
              {item.attachment.contentType.startsWith("image/") ? (
                <img src={item.attachment.url} alt={item.attachment.caption ?? "Bilde"} className="max-h-[50dvh] w-full rounded-md object-contain" />
              ) : (
                <span className="font-semibold text-primary-strong underline">{item.attachment.filename}</span>
              )}
            </a>
          )}
          {d.detail && <p className="text-muted">{d.detail}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small">
            <dt className="text-muted">Tidspunkt</dt>
            <dd>{new Date(item.occurredAt).toLocaleString("nb-NO")}</dd>
            <dt className="text-muted">Registrert av</dt>
            <dd>{item.createdBy.name}</dd>
            {item.stage && (
              <>
                <dt className="text-muted">Steg</dt>
                <dd>{brewStageLabels[item.stage]}</dd>
              </>
            )}
          </dl>
          {(editComment.error || deleteEvent.error) && <InlineError>{(editComment.error ?? deleteEvent.error)?.message}</InlineError>}
          <div className="flex flex-wrap gap-2">
            {item.comment && canEdit && draft === null && (
              <Button icon="edit" onClick={() => setDraft(item.comment?.body ?? "")}>
                Rediger
              </Button>
            )}
            {item.comment && draft !== null && (
              <Button
                variant="primary"
                loading={editComment.isPending}
                disabled={!draft.trim()}
                onClick={() =>
                  editComment.mutate(
                    { commentId: item.comment?.id as string, body: draft.trim() },
                    { onSuccess: () => (toast("Kommentar oppdatert"), close()) },
                  )
                }
              >
                Lagre
              </Button>
            )}
            {canDelete && item.type !== "status_changed" && (
              <Button variant="ghost" icon="trash" className="text-danger" onClick={() => setConfirming(true)}>
                Slett
              </Button>
            )}
          </div>
        </div>
      </BottomSheet>
      <ConfirmDialog
        open={confirming}
        title="Slette loggføringen?"
        confirmLabel="Slett"
        danger
        loading={deleteEvent.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() =>
          deleteEvent.mutate(item.id, {
            onSuccess: () => {
              toast("Loggføringen er slettet");
              setConfirming(false);
              close();
            },
          })
        }
      >
        Den fjernes fra bryggeloggen for alle.
      </ConfirmDialog>
    </>
  );
}

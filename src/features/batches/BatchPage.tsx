import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { buildBrewDocument } from "../../domain/brew-document/brew-document.ts";
import { activeTimers, dueAlarms, type Alarm } from "../../domain/brew-day/alarms.ts";
import { buildBrewPlan, registeredIngredientIds, type PlanAddition } from "../../domain/brew-day/brew-plan.ts";
import { buildFermentationSeries, splitIdForVariant } from "../../domain/brew-day/fermentation.ts";
import { deriveBrewDayState, type NextAction, type PlannedAddition } from "../../domain/brew-day/state.ts";
import type { BatchDetail, TimelineItem } from "../../domain/model/api.ts";
import { brewStageLabels, brewStages, fermentationHasStarted, type BrewStage } from "../../domain/model/brewing.ts";
import {
  BottomSheet,
  Button,
  buttonClasses,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Icon,
  InlineError,
  LoadingState,
  PageHeader,
  parseDecimal,
  Section,
  SectionLabel,
  StatusChip,
  TextInput,
  useToast,
} from "../../design-system/index.ts";
import { formatNumber } from "../../lib/format.ts";
import { useMe } from "../auth/session.ts";
import { useBrewery } from "../breweries/BreweryContext.tsx";
import { useBatch, useCreateSplit, useDeleteBatch, useLogEvent, useStartStage, useTimeline, useUpdateBatch } from "./api.ts";
import { StageBody, NextBlock } from "./ActiveStep.tsx";
import { BrewActionBar } from "./BrewActionBar.tsx";
import { AlarmBanner, TimerPanel } from "./BrewTimers.tsx";
import { BrewLog } from "./BrewLog.tsx";
import { BrewDocumentPanel } from "./BrewDocumentPanel.tsx";
import { BrewPlanOverview } from "./BrewPlanOverview.tsx";
import { FermentationCard } from "./FermentationCard.tsx";
import { FermentationChart } from "./FermentationChart.tsx";
import { ResultSummary } from "./ResultSummary.tsx";
import { statusLabel, statusTones, toBrewDayLog } from "./helpers.ts";
import { LogSheet, type LogIntent } from "./LogSheet.tsx";
import { OccurredAtInput, occurredAtOf } from "./OccurredAtInput.tsx";
import { PreBrewOverview } from "./PreBrewOverview.tsx";
import { useBrewAlarms } from "./useBrewAlarms.ts";
import { useScreenWakeLock } from "./useScreenWakeLock.ts";
import { VeilederPanel } from "../assistant/VeilederPanel.tsx";

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * The brew-day screen (spec §35) — the most important screen in the app. It always answers:
 * what is happening now, what is the target, what did we measure, and what is next.
 */
export function BatchPage() {
  const { batchId } = useParams();
  const batch = useBatch(batchId);
  const timeline = useTimeline(batchId, batch.data?.status !== "completed");

  if (batch.isPending || timeline.isPending) {
    return (
      <>
        <PageHeader back="/brygg" title="Laster brygget …" />
        <LoadingState />
      </>
    );
  }
  if (batch.error || timeline.error) {
    return (
      <>
        <PageHeader back="/brygg" title="Brygg" />
        <ErrorState error={batch.error ?? timeline.error} onRetry={() => void (batch.refetch(), timeline.refetch())} />
      </>
    );
  }
  return <BrewDay batch={batch.data} timeline={timeline.data} />;
}

function BrewDay({ batch, timeline }: { batch: BatchDetail; timeline: TimelineItem[] }) {
  const me = useMe();
  const { isAdmin } = useBrewery();
  const toast = useToast();
  const navigate = useNavigate();
  const startStage = useStartStage(batch.id);
  const updateBatch = useUpdateBatch(batch.id);
  const logEvent = useLogEvent(batch.id);
  const [intent, setIntent] = useState<LogIntent | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [veilederOpen, setVeilederOpen] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [screenOn, setScreenOn] = useState(true);
  useScreenWakeLock(batch.status === "brewing" && screenOn);

  const log = useMemo(() => toBrewDayLog(timeline), [timeline]);
  const timers = useMemo(() => (batch.status === "completed" ? [] : activeTimers(log)), [log, batch.status]);
  const hasTimer = timers.length > 0 || (batch.currentStage !== null && ["mash", "boil", "whirlpool"].includes(batch.currentStage));
  const now = useNow(hasTimer ? 1000 : 30_000);
  const state = useMemo(
    () =>
      deriveBrewDayState({
        recipe: batch.recipeSnapshot,
        stage: batch.currentStage,
        stageStartedAt: batch.stageStartedAt,
        log,
        now,
        wcf: batch.equipmentSnapshot.values.refractometer_wcf,
        equipment: batch.equipmentSnapshot.values,
        equipmentSources: batch.equipmentSnapshot.sources,
        completed: batch.status === "completed",
      }),
    [batch, log, now],
  );
  const alarms = useBrewAlarms(batch.id, batch.status === "completed" ? [] : dueAlarms({ state, timers, now }));
  const fermenting = batch.currentStage === "fermentation" || batch.currentStage === "conditioning";
  const variants = useMemo(
    () => buildFermentationSeries({ log, splits: batch.splits, wcf: batch.equipmentSnapshot.values.refractometer_wcf, recipe: batch.recipeSnapshot }),
    [batch, log],
  );

  const plan = useMemo(
    () => buildBrewPlan({ recipe: batch.recipeSnapshot, equipment: batch.equipmentSnapshot.values, equipmentSources: batch.equipmentSnapshot.sources, doneIngredientIds: registeredIngredientIds(log) }),
    [batch.recipeSnapshot, batch.equipmentSnapshot.values, log],
  );
  const documentNow = Math.floor(now / 30_000) * 30_000;
  const brewDocument = useMemo(() => buildBrewDocument({ batch, timeline, now: documentNow }), [batch, timeline, documentNow]);

  const user = me.data?.user ?? { id: "", name: "" };
  const pendingAdditions = state.additions.filter((a) => a.status !== "done");
  const originalBrix = timeline.findLast((item) => item.measurement?.kind === "brix" && !fermentationHasStarted(item.stage))?.measurement?.value;

  // The planned amount is prefilled but can be changed: dry hops are adjusted to taste.
  function addIngredient(addition: PlannedAddition) {
    setIntent({ kind: "addition", addition });
  }

  // From the brew plan, any planned addition can be registered whenever it actually happens.
  function addFromPlan(addition: PlanAddition) {
    if (addition.eventType === "yeast_pitched") {
      const { eventType: _type, variant: _variant, ...data } = addition;
      logEvent.mutate(
        { type: "yeast_pitched", stage: batch.currentStage, splitId: splitIdForVariant(batch.splits, addition.variant), data },
        { onSuccess: () => toast(`${addition.name} registrert`) },
      );
      return;
    }
    const live = state.additions.find((a) => a.ingredientId === addition.ingredientId);
    addIngredient(live ?? { ...addition, dueAt: 0, dueLabel: "", status: "due" });
  }

  // One tap from the alarm: the planned amount at the planned time, like the brew sheet says.
  function registerFromAlarm(alarm: Alarm) {
    const addition = alarm.addition;
    if (!addition) return;
    logEvent.mutate(
      {
        type: "ingredient_added",
        stage: batch.currentStage,
        data: { ingredientKind: addition.ingredientKind, ingredientId: addition.ingredientId, name: addition.name, amount: addition.amount, unit: addition.unit },
      },
      { onSuccess: () => (alarms.acknowledge(alarm.key), toast(`${addition.name} registrert`)) },
    );
  }

  function startTimer(label: string, durationMin: number) {
    logEvent.mutate({ type: "timer_started", stage: batch.currentStage, data: { label, durationMin } }, { onSuccess: () => toast(`Timer startet: ${label}`) });
  }

  function cancelTimer(timerId: string) {
    logEvent.mutate({ type: "timer_cancelled", stage: batch.currentStage, data: { timerId } });
  }

  function logMashWater(volumeL: number, temperatureC: number) {
    logEvent.mutate(
      { type: "water_added", stage: batch.currentStage, data: { volumeL, temperatureC, reason: "mash_adjust" } },
      { onSuccess: () => toast("Vann tilsatt er loggført") },
    );
  }

  function goToStage(stage: BrewStage, occurredAt?: number) {
    startStage.mutate({ stage, occurredAt }, { onSuccess: () => toast(`${brewStageLabels[stage]} startet`) });
  }

  function runNextAction(action: NextAction) {
    switch (action.kind) {
      case "start_stage":
        return goToStage(action.stage);
      case "add_ingredient":
        return addIngredient(action.addition);
      case "log_measurement":
        return setIntent({ kind: "measurement", measurementKind: action.measurementKind });
      case "complete":
        return navigate(`/batcher/${batch.id}/resultat`);
    }
  }

  return (
    <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-5">
      <AlarmBanner
        alarms={alarms.current}
        onAcknowledge={alarms.acknowledge}
        onRegister={registerFromAlarm}
        registering={logEvent.isPending}
        soundLocked={alarms.soundOn && alarms.sound === "locked"}
        onEnableSound={() => alarms.setSoundOn(true)}
      />
      <PageHeader
        back="/brygg"
        eyebrow={
          <StatusChip tone={statusTones[batch.status]}>
            {statusLabel(batch.status)}
            {state.fermentationDay !== null && batch.status !== "completed" ? ` · dag ${state.fermentationDay}` : ""}
          </StatusChip>
        }
        title={batch.name}
        subtitle={`#${batch.number} · ${batch.recipe.name} v${batch.recipeVersion.version}`}
        actions={
          <div className="flex items-center gap-1">
            {batch.status === "brewing" && (
              <Button
                variant={screenOn ? "secondary" : "ghost"}
                icon={screenOn ? "sun" : "moon"}
                aria-pressed={screenOn}
                onClick={() => setScreenOn((value) => !value)}
              >
                {/* Icon only on phones, so the batch name keeps its width. */}
                <span className="sr-only md:not-sr-only">{screenOn ? "Skjerm på" : "Skjerm av"}</span>
              </Button>
            )}
            <IconButton icon="dots" label="Flere valg" onClick={() => setMenuOpen(true)} />
          </div>
        }
      />

      {batch.status === "completed" ? (
        <CompletedCard batch={batch} />
      ) : batch.currentStage === null ? (
        <PreBrewOverview batch={batch} onStart={() => goToStage("mash")} starting={startStage.isPending} />
      ) : (
        <Card>
          {fermenting ? (
            <FermentationCard batch={batch} state={state} variants={variants} now={now} onLog={setIntent} />
          ) : (
            <StageBody
              state={state}
              onLog={setIntent}
              timeline={timeline}
              recipe={batch.recipeSnapshot}
              equipment={batch.equipmentSnapshot.values}
              equipmentSources={batch.equipmentSnapshot.sources}
              log={log}
              now={now}
              onAddMashWater={logMashWater}
              loggingMashWater={logEvent.isPending}
            />
          )}
          {state.nextAction && (
            <NextBlock
              action={state.nextAction}
              remainingMin={state.step?.remainingMin ?? null}
              loading={startStage.isPending || updateBatch.isPending}
              onRun={runNextAction}
            />
          )}
          {(batch.status === "brewing" || timers.length > 0) && (
            <TimerPanel
              timers={timers}
              now={now}
              onStart={startTimer}
              onCancel={cancelTimer}
              busy={logEvent.isPending}
              error={logEvent.error?.message}
              soundOn={alarms.soundOn}
              sound={alarms.sound}
              onSoundChange={alarms.setSoundOn}
            />
          )}
        </Card>
      )}

      {batch.status !== "completed" && (
        <BrewPlanOverview
          plan={plan}
          forecast={state.forecast}
          currentStage={batch.currentStage}
          liveAdditions={state.additions}
          elapsedMin={state.elapsedMin}
          onAdd={addFromPlan}
          busy={logEvent.isPending}
        />
      )}

      <ResultSummary batch={batch} />

      {(fermenting || batch.currentStage === "packaging" || batch.status === "completed") && (
        <FermentationChart variants={variants} until={batch.completedAt ?? now} />
      )}

      <Section
        title="Logg"
        action={
          <Button variant="ghost" size="sm" icon="plus" onClick={() => setIntent({ kind: "menu" })}>
            Logg noe
          </Button>
        }
      >
        {timeline.length === 0 ? (
          <EmptyState icon="clock" title="Ingenting logget ennå" action={<Button icon="plus" onClick={() => setIntent({ kind: "menu" })}>Logg noe</Button>}>
            Målinger, kommentarer og bilder fra alle i bryggeriet samles her.
          </EmptyState>
        ) : (
          <>
            <BrewLog batch={batch} items={timeline} currentUserId={user.id} isAdmin={isAdmin} limit={showAll ? undefined : 8} />
            {timeline.length > 8 && (
              <Button variant="ghost" block onClick={() => setShowAll(!showAll)}>
                {showAll ? "Vis færre" : `Vis hele loggen (${timeline.length})`}
              </Button>
            )}
          </>
        )}
      </Section>

      <BrewDocumentPanel markdown={brewDocument} hasLog={timeline.length > 0} batchStatus={batch.status} open={documentOpen} onOpenChange={setDocumentOpen} />

      {batch.splits.length > 0 && <SplitsSection batch={batch} />}

      {/* Room for the floating button so it never covers the last log entry. */}
      <div className="h-16 md:hidden" aria-hidden="true" />

      <LogSheet
        batch={batch}
        stage={batch.currentStage}
        originalBrix={originalBrix}
        intent={intent}
        onIntent={setIntent}
        onClose={() => setIntent(null)}
        pendingAdditions={pendingAdditions}
        currentUser={user}
      />
      <BatchMenu
        batch={batch}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onStage={goToStage}
        onComplete={() => navigate(`/batcher/${batch.id}/resultat`)}
        onOpenDocument={() => {
          setDocumentOpen(true);
          window.setTimeout(() => document.getElementById("bryggedokument")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
        }}
      />
      </div>
      {/* Outside the space-y column: a fixed element there would pick up its 20 px bottom margin. */}
      <BrewActionBar stage={batch.currentStage} onVeileder={() => setVeilederOpen(true)} onLog={() => setIntent({ kind: "menu" })} />
      <VeilederPanel batch={batch} open={veilederOpen} onClose={() => setVeilederOpen(false)} />
    </div>
  );
}

function CompletedCard({ batch }: { batch: BatchDetail }) {
  return (
    <Card className="space-y-3">
      <SectionLabel>Ferdig</SectionLabel>
      <p className="text-muted">
        Avsluttet {batch.completedAt ? new Date(batch.completedAt).toLocaleDateString("nb-NO", { day: "numeric", month: "long" }) : ""}.
        {batch.outcomes.length === 0 && " Ingen resultat er lagret ennå."}
      </p>
      {batch.outcomes.length === 0 && (
        <Link to={`/batcher/${batch.id}/resultat`} className={buttonClasses("primary", "md", true)}>
          Registrer resultat
        </Link>
      )}
      <Link to={`/batcher/${batch.id}/rapport`} className={buttonClasses("secondary", "md", true)}>
        Se rapporten
      </Link>
    </Card>
  );
}

function SplitsSection({ batch }: { batch: BatchDetail }) {
  return (
    <Section title="Varianter">
      <div className="grid gap-2 sm:grid-cols-2">
        {batch.splits.map((split) => (
          <Card key={split.id} as="div" className="p-3 md:p-4">
            <p className="font-semibold">{split.name}</p>
            <p className="text-small text-muted">
              {[split.vessel, split.volumeL ? `${formatNumber(split.volumeL, 0)} L` : null].filter(Boolean).join(" · ")}
            </p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function BatchMenu({
  batch,
  open,
  onClose,
  onStage,
  onComplete,
  onOpenDocument,
}: {
  batch: BatchDetail;
  open: boolean;
  onClose: () => void;
  onStage: (stage: BrewStage, occurredAt?: number) => void;
  onComplete: () => void;
  onOpenDocument: () => void;
}) {
  const { isAdmin } = useBrewery();
  const toast = useToast();
  const navigate = useNavigate();
  const updateBatch = useUpdateBatch(batch.id);
  const createSplit = useCreateSplit(batch.id);
  const deleteBatch = useDeleteBatch();
  const [view, setView] = useState<"menu" | "stage" | "split" | "details" | "delete">("menu");
  const [splitName, setSplitName] = useState("");
  const [splitVessel, setSplitVessel] = useState("");
  const [splitVolume, setSplitVolume] = useState("");
  const [stageTime, setStageTime] = useState<string | null>(null);
  const [batchName, setBatchName] = useState(batch.name);
  const [brewDate, setBrewDate] = useState(batch.brewDate ?? "");

  useEffect(() => {
    setBatchName(batch.name);
    setBrewDate(batch.brewDate ?? "");
  }, [batch.name, batch.brewDate, open]);

  const close = () => {
    setView("menu");
    setStageTime(null);
    onClose();
  };

  return (
    <>
      <BottomSheet
        open={open && view !== "delete"}
        onClose={close}
        title={view === "stage" ? "Gå til steg" : view === "split" ? "Ny variant" : view === "details" ? "Batchdetaljer" : "Batch"}
      >
        {view === "menu" && (
          <div className="grid gap-2">
            <Button block icon="edit" onClick={() => setView("details")}>
              Rediger navn og dato
            </Button>
            {batch.status !== "completed" && (
              <Button block icon="play" onClick={() => setView("stage")}>
                Gå til steg …
              </Button>
            )}
            <Button block icon="split" onClick={() => setView("split")}>
              Del i varianter (split)
            </Button>
            <Link to={`/oppskrifter/${batch.recipe.id}`} className={buttonClasses("secondary", "md", true)}>
              <Icon name="book" size={20} />
              Åpne oppskriften
            </Link>
            <Button block icon="file" onClick={() => (close(), onOpenDocument())}>
              Bryggedokument
            </Button>
            <Link to={`/batcher/${batch.id}/rapport`} className={buttonClasses("secondary", "md", true)}>
              <Icon name="file" size={20} />
              Rapport (PDF)
            </Link>
            <Link to={`/assistent?batch=${batch.id}`} className={buttonClasses("secondary", "md", true)}>
              <Icon name="sparkles" size={20} />
              Spør assistenten
            </Link>
            {batch.status === "completed" ? (
              <Button
                block
                icon="history"
                loading={updateBatch.isPending}
                onClick={() =>
                  updateBatch.mutate({ status: batch.currentStage ? "fermenting" : "planned" }, { onSuccess: () => (toast("Batchen er gjenåpnet"), close()) })
                }
              >
                Gjenåpne
              </Button>
            ) : (
              <Button block icon="check" onClick={() => (close(), onComplete())}>
                Avslutt batch
              </Button>
            )}
            {isAdmin && (
              <Button block variant="ghost" icon="trash" className="text-danger" onClick={() => setView("delete")}>
                Slett batch
              </Button>
            )}
          </div>
        )}
        {view === "stage" && (
          <div className="grid gap-2">
            <OccurredAtInput value={stageTime} onChange={setStageTime} />
            {brewStages.map((stage) => (
              <Button
                key={stage}
                block
                variant={stage === batch.currentStage ? "primary" : "secondary"}
                onClick={() => {
                  onStage(stage, occurredAtOf(stageTime));
                  close();
                }}
              >
                {brewStageLabels[stage]}
              </Button>
            ))}
          </div>
        )}
        {view === "details" && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              updateBatch.mutate(
                { name: batchName.trim(), brewDate: brewDate || null },
                { onSuccess: () => (toast("Batchdetaljer oppdatert"), close()) },
              );
            }}
          >
            <Field label="Batchnavn">
              {(props) => <TextInput {...props} required maxLength={120} value={batchName} onChange={(event) => setBatchName(event.target.value)} />}
            </Field>
            <Field label="Bryggedato">
              {(props) => <TextInput {...props} type="date" value={brewDate} onChange={(event) => setBrewDate(event.target.value)} />}
            </Field>
            {updateBatch.error && <InlineError>{updateBatch.error.message}</InlineError>}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={updateBatch.isPending}>Lagre</Button>
              <Button variant="ghost" onClick={() => setView("menu")}>Avbryt</Button>
            </div>
          </form>
        )}
        {view === "split" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const volume = parseDecimal(splitVolume);
              createSplit.mutate(
                { name: splitName.trim(), vessel: splitVessel.trim() || null, volumeL: volume && !Number.isNaN(volume) ? volume : null },
                {
                  onSuccess: () => {
                    toast("Variant lagt til");
                    setSplitName("");
                    setSplitVessel("");
                    setSplitVolume("");
                    close();
                  },
                },
              );
            }}
          >
            <p className="text-small text-muted">Brukes når vørteren fordeles på flere gjæringskar, f.eks. Tropical og Pine.</p>
            <Field label="Navn">{(p) => <TextInput {...p} required autoFocus value={splitName} onChange={(e) => setSplitName(e.target.value)} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kar">{(p) => <TextInput {...p} value={splitVessel} onChange={(e) => setSplitVessel(e.target.value)} placeholder="FermZilla" />}</Field>
              <Field label="Volum (L)">
                {(p) => <TextInput {...p} inputMode="decimal" value={splitVolume} onChange={(e) => setSplitVolume(e.target.value)} />}
              </Field>
            </div>
            {createSplit.error && <InlineError>{createSplit.error.message}</InlineError>}
            <Button type="submit" variant="primary" size="lg" block loading={createSplit.isPending}>
              Legg til variant
            </Button>
          </form>
        )}
      </BottomSheet>
      <ConfirmDialog
        open={open && view === "delete"}
        title="Slette batchen?"
        confirmLabel="Slett"
        danger
        loading={deleteBatch.isPending}
        onClose={() => setView("menu")}
        onConfirm={() => deleteBatch.mutate(batch.id, { onSuccess: () => (toast("Batchen er slettet"), close(), navigate("/brygg")) })}
      >
        Batchen og loggen skjules for alle. Dette kan ikke angres fra appen.
      </ConfirmDialog>
    </>
  );
}

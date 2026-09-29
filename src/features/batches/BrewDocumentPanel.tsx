import { useMemo, useState } from "react";
import type { BatchStatus } from "../../domain/model/brewing.ts";
import { Card, Icon, markdownInline, MarkdownList } from "../../design-system/index.ts";
import { parseBrewDocument, type BrewDocumentBlock } from "./brew-document-view.ts";

function DocumentBlocks({ blocks }: { blocks: BrewDocumentBlock[] }) {
  return blocks.map((block, index) => {
    if (block.kind === "heading") return <h3 key={index} className="font-semibold text-text">{block.text}</h3>;
    if (block.kind === "paragraph") return <p key={index}>{markdownInline(block.text)}</p>;
    return <MarkdownList key={index} items={block.items} ordered={false} />;
  });
}

/**
 * The same deterministic document that the assistant reads, shown without an AI request. Closed by
 * default so it stays out of the brew-day flow; the batch menu opens it.
 */
export function BrewDocumentPanel({
  markdown,
  hasLog,
  batchStatus,
  open,
  onOpenChange,
}: {
  markdown: string;
  hasLog: boolean;
  batchStatus: BatchStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const sections = useMemo(() => parseBrewDocument(markdown), [markdown]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const initiallyOpen = (title: string) =>
    title === "Status nå" ||
    title === "Hva brygget sier om kalibreringen" ||
    (batchStatus === "planned" && title === "Plan og mål") ||
    (batchStatus === "completed" && title === "Resultat");

  return (
    <div id="bryggedokument" className="scroll-mt-4">
      <Card flush className="overflow-hidden">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-controls="bryggedokument-innhold"
          className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left md:px-5"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Bryggedokument</span>
            <span className="block text-small text-muted">Plan, målinger og kalibreringsgrunnlag. Det samme Veileder leser.</span>
          </span>
          <Icon name="chevronDown" size={20} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
        <div id="bryggedokument-innhold" className="border-t border-border">
          {!hasLog && (
            <p className="px-4 pt-4 text-small text-muted md:px-5">Ingenting logget ennå. Manglende målinger står som «ikke målt».</p>
          )}
          <div className="divide-y divide-border">
            {sections.map((section, index) => {
              const sectionOpen = expanded[section.title] ?? initiallyOpen(section.title);
              const contentId = `bryggedokument-del-${index}`;
              return (
                <div key={section.title}>
                  <button
                    type="button"
                    aria-expanded={sectionOpen}
                    aria-controls={contentId}
                    onClick={() => setExpanded((current) => ({ ...current, [section.title]: !sectionOpen }))}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left font-semibold text-text hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary md:px-5"
                  >
                    <span className="min-w-0 flex-1">{section.title}</span>
                    <Icon name="chevronRight" size={20} className={`shrink-0 text-muted transition-transform ${sectionOpen ? "rotate-90" : ""}`} />
                  </button>
                  <div
                    id={contentId}
                    hidden={!sectionOpen}
                    className="space-y-3 border-t border-border px-4 pt-3 pb-4 text-small leading-6 text-text break-words tabular md:px-5 md:pb-5"
                  >
                    <DocumentBlocks blocks={section.blocks} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )}
      </Card>
    </div>
  );
}

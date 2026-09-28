/** Presentation blocks parsed from the Markdown produced by buildBrewDocument. */
export type BrewDocumentBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: { text: string; nested: boolean }[] };

export interface BrewDocumentSection {
  title: string;
  blocks: BrewDocumentBlock[];
}

const sectionHeadings = new Set(["Plan og mål", "Status nå", "Resultat", "Hva brygget sier om kalibreringen", "Logg"]);

function isSectionHeading(title: string): boolean {
  return sectionHeadings.has(title) || title.startsWith("Utstyrsprofil i batchen");
}

function parseBlocks(lines: string[], allowPhaseHeadings: boolean): BrewDocumentBlock[] {
  const blocks: BrewDocumentBlock[] = [];
  let paragraph: string[] = [];
  let items: { text: string; nested: boolean }[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (items.length > 0) blocks.push({ kind: "list", items });
    items = [];
  };

  for (const line of lines) {
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (allowPhaseHeadings && line.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", text: line.slice(4).trim() });
    } else if (/^\s*-\s+/.test(line)) {
      flushParagraph();
      items.push({ text: line.replace(/^\s*-\s+/, "").trim(), nested: /^\s+-/.test(line) });
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Parse the builder's known sections; later log text may contain arbitrary Markdown. */
export function parseBrewDocument(markdown: string): BrewDocumentSection[] {
  const rawSections: { title: string; lines: string[] }[] = [{ title: "Om brygget", lines: [] }];
  let current = rawSections[0]!;
  let inLog = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("# ") && rawSections.length === 1 && current.lines.every((entry) => !entry.trim())) continue;
    if (!inLog && line.startsWith("## ")) {
      const title = line.slice(3).trim();
      if (isSectionHeading(title)) {
        current = { title, lines: [] };
        rawSections.push(current);
        inLog = title === "Logg";
        continue;
      }
    }
    current.lines.push(line);
  }

  return rawSections
    .map(({ title, lines }) => ({ title, blocks: parseBlocks(lines, title === "Plan og mål") }))
    .filter((section) => section.blocks.length > 0);
}

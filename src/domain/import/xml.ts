/**
 * Minimal, defensive XML reader for recipe imports (BeerSmith BSMX, BeerXML).
 *
 * Workers have no DOMParser, and both formats are plain element trees without meaningful
 * attributes, so this reader only builds elements and text. It rejects DOCTYPE and entity
 * declarations outright (no entity expansion, no external references) and enforces limits on
 * size, nesting depth and element count before anything reaches an adapter.
 */

export interface XmlElement {
  name: string;
  children: XmlElement[];
  /** Direct text content with entities decoded, untrimmed. */
  text: string;
}

export interface XmlLimits {
  maxChars: number;
  maxDepth: number;
  maxElements: number;
}

export const DEFAULT_XML_LIMITS: XmlLimits = { maxChars: 2_000_000, maxDepth: 32, maxElements: 50_000 };

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

const NAME = /[A-Za-z_][\w.:-]*/y;
const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,4});/g, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      // Unpaired surrogates and out-of-range code points are kept as written.
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
      return String.fromCodePoint(code);
    }
    // Unknown named entities (BeerSmith sometimes writes bare "&") stay literal.
    return NAMED_ENTITIES[body] ?? match;
  });
}

export function parseXml(input: string, limits: Partial<XmlLimits> = {}): XmlElement {
  const { maxChars, maxDepth, maxElements } = { ...DEFAULT_XML_LIMITS, ...limits };
  if (input.length > maxChars) throw new XmlParseError("Filen er for stor.");
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new XmlParseError("Filen inneholder DOCTYPE eller entiteter og avvises.");

  let pos = input.charCodeAt(0) === 0xfeff ? 1 : 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let elements = 0;

  const fail = (message: string): never => {
    throw new XmlParseError(`Ugyldig XML (tegn ${pos}): ${message}`);
  };
  const readName = (): string => {
    NAME.lastIndex = pos;
    const match = NAME.exec(input);
    if (!match) fail("forventet et elementnavn");
    pos = NAME.lastIndex;
    return match![0];
  };
  const skipPast = (terminator: string, what: string): number => {
    const end = input.indexOf(terminator, pos);
    if (end === -1) fail(`${what} er ikke avsluttet`);
    const start = pos;
    pos = end + terminator.length;
    return start;
  };

  while (pos < input.length) {
    const lt = input.indexOf("<", pos);
    const textEnd = lt === -1 ? input.length : lt;
    if (textEnd > pos) {
      const text = input.slice(pos, textEnd);
      const current = stack.at(-1);
      if (current) current.text += decodeEntities(text);
      else if (text.trim()) fail("tekst utenfor rotelementet");
      pos = textEnd;
      continue;
    }

    if (input.startsWith("<?", pos)) {
      skipPast("?>", "prosesseringsinstruksjon");
    } else if (input.startsWith("<!--", pos)) {
      skipPast("-->", "kommentar");
    } else if (input.startsWith("<![CDATA[", pos)) {
      pos += 9;
      const start = skipPast("]]>", "CDATA");
      const current = stack.at(-1) ?? fail("CDATA utenfor rotelementet");
      current.text += input.slice(start, pos - 3);
    } else if (input.startsWith("<!", pos)) {
      fail("deklarasjoner støttes ikke");
    } else if (input.startsWith("</", pos)) {
      pos += 2;
      const name = readName();
      while (/\s/.test(input[pos] ?? "")) pos += 1;
      if (input[pos] !== ">") fail(`forventet «>» etter </${name}`);
      pos += 1;
      const open = stack.pop();
      if (!open || open.name !== name) fail(`</${name}> passer ikke med <${open?.name ?? "ingenting"}>`);
    } else {
      pos += 1;
      const name = readName();
      // Attributes carry no data in BSMX or BeerXML; skip them, respecting quotes.
      let selfClosing = false;
      for (;;) {
        const char = input[pos];
        if (char === undefined) fail(`<${name}> er ikke avsluttet`);
        if (char === '"' || char === "'") {
          const close = input.indexOf(char, pos + 1);
          if (close === -1) fail("attributtverdi er ikke avsluttet");
          pos = close + 1;
        } else if (char === ">") {
          pos += 1;
          break;
        } else if (char === "/" && input[pos + 1] === ">") {
          pos += 2;
          selfClosing = true;
          break;
        } else if (char === "<") {
          fail(`<${name}> er ikke avsluttet`);
        } else {
          pos += 1;
        }
      }

      elements += 1;
      if (elements > maxElements) throw new XmlParseError("Filen har for mange elementer.");
      const element: XmlElement = { name, children: [], text: "" };
      const parent = stack.at(-1);
      if (parent) parent.children.push(element);
      else if (root) fail("mer enn ett rotelement");
      else root = element;
      if (!selfClosing) {
        stack.push(element);
        if (stack.length > maxDepth) throw new XmlParseError("Filen er for dypt nøstet.");
      }
    }
  }

  if (stack.length > 0) fail(`<${stack.at(-1)!.name}> er ikke avsluttet`);
  if (!root) throw new XmlParseError("Filen inneholder ingen XML.");
  return root;
}

export function childElement(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((child) => child.name === name);
}

export function childElements(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name);
}

/** All descendants named `name`, depth first, without descending into matches. */
export function findElements(element: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const visit = (node: XmlElement) => {
    for (const child of node.children) {
      if (child.name === name) found.push(child);
      else visit(child);
    }
  };
  visit(element);
  return found;
}

/** Trimmed text of a direct child, or undefined when the child is missing or empty. */
export function childText(element: XmlElement, name: string): string | undefined {
  const text = childElement(element, name)?.text.trim();
  return text ? text : undefined;
}

/** Finite number from a direct child's text, or undefined. */
export function childNumber(element: XmlElement, name: string): number | undefined {
  const text = childText(element, name);
  if (text === undefined) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

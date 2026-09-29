import type { ReactNode } from "react";
import { cx } from "./cx.ts";

/**
 * Shared rendering for the limited Markdown subset the app itself produces (assistant replies and
 * the brew document): **bold** text and flat or one-level-nested bullet/numbered lists. Never
 * renders raw HTML.
 */

/** Splits a line on **bold** spans; everything else is returned as plain text. */
export function markdownInline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, index) => (part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part));
}

export interface MarkdownListItem {
  text: string;
  /** One indent level in, e.g. a tasting note under its batch line. */
  nested?: boolean;
}

export function MarkdownList({ items, ordered }: { items: MarkdownListItem[]; ordered: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={cx(ordered ? "list-decimal" : "list-disc", "space-y-1 pl-5")}>
      {items.map((item, index) => (
        <li key={index} className={item.nested ? "ml-4" : undefined}>
          {markdownInline(item.text)}
        </li>
      ))}
    </Tag>
  );
}

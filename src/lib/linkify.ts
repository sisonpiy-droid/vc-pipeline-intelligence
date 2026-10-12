/** Web addresses inside plain text. The trailing punctuation of a sentence is not part of the address. */
export const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)])/g;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The same text as HTML with every web address as a real link, for pasting into a mail composer that keeps formatting. */
export function toHtml(text: string): string {
  return text.split(URL_RE).map((part, i) => (i % 2 ? `<a href="${esc(part)}">${esc(part)}</a>` : esc(part))).join("").replace(/\n/g, "<br>");
}

import { URL_RE } from "@/lib/linkify";

/** Plain text in which every web address (the Calendly link, for one) is a clickable link. */
export function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((part, i) =>
        i % 2 ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline underline-offset-2">{part}</a> : part,
      )}
    </>
  );
}

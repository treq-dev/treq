import { cn } from "../lib/utils";

/**
 * Single-line text that truncates from the start. Branches in a stack often
 * share a long prefix, so the tail is what tells them apart. The rtl box puts
 * the ellipsis on the left; the <bdi> keeps the text itself left-to-right.
 */
export function StartTruncatedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <span
      dir="rtl"
      title={text}
      className={cn("block truncate text-left", className)}
    >
      <bdi>{text}</bdi>
    </span>
  );
}

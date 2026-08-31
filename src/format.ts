/** `count: N` / `count: N (showing first N)` when a display limit truncates the list. */
export function formatCountLine(count: number, displayLimit?: number): string {
  if (displayLimit !== undefined && count > displayLimit) {
    return `count: ${count} (showing first ${displayLimit})`;
  }
  return `count: ${count}`;
}

/** Truncate long text for display, unless `full` is set. */
export function truncateText(
  text: string,
  maxLen: number,
  full: boolean,
): string {
  if (full || text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen)}... (truncated, use --full to see complete text)`;
}

/**
 * Touch-only control-sequence toolbar for `RemoteTerminalScreen` (mobile
 * remote PRD, Phase 7 item 3). A mobile software keyboard has no Ctrl, Esc,
 * or arrow keys, so raw agent TUIs and ad hoc shell use need an explicit way
 * to send those bytes. Each button writes the literal control sequence a
 * physical key would produce straight to the remote PTY via `onSend`.
 */
const ARROW_KEYS: { label: string; sequence: string }[] = [
  { label: "↑", sequence: "\x1b[A" },
  { label: "↓", sequence: "\x1b[B" },
  { label: "→", sequence: "\x1b[C" },
  { label: "←", sequence: "\x1b[D" },
];

const CONTROL_KEYS: { label: string; sequence: string }[] = [
  { label: "Esc", sequence: "\x1b" },
  { label: "Tab", sequence: "\t" },
  { label: "Ctrl+C", sequence: "\x03" },
  { label: "Ctrl+D", sequence: "\x04" },
  { label: "Ctrl+Z", sequence: "\x1a" },
];

export function RemoteTerminalTouchToolbar({
  onSend,
}: {
  onSend: (sequence: string) => void;
}) {
  return (
    <div className="flex flex-shrink-0 gap-2 overflow-x-auto border-t border-border bg-background px-2 py-2">
      {CONTROL_KEYS.map((key) => (
        <button
          key={key.label}
          type="button"
          onClick={() => onSend(key.sequence)}
          className="flex-shrink-0 rounded-md border px-3 py-1.5 font-mono text-xs"
        >
          {key.label}
        </button>
      ))}
      <div className="flex flex-shrink-0 gap-1">
        {ARROW_KEYS.map((key) => (
          <button
            key={key.label}
            type="button"
            onClick={() => onSend(key.sequence)}
            className="flex-shrink-0 rounded-md border px-3 py-1.5 font-mono text-xs"
          >
            {key.label}
          </button>
        ))}
      </div>
    </div>
  );
}

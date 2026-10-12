import { useCallback, useState } from "react";
import { Bot } from "lucide-react";
import { AskAIExperience } from "./AskAIExperience";
import { useDialogFocus } from "./useDialogFocus";

export function AskAIPanel() {
  const [open, setOpen] = useState(false);
  const closePanel = useCallback(() => setOpen(false), []);
  const dialogRef = useDialogFocus<HTMLElement>(open, closePanel);

  return (
    <>
      <button
        className="ask-ai-button"
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Bot size={17} aria-hidden="true" />
        <span>Ask platform AI</span>
      </button>
      {open && (
        <div className="drawer-backdrop" onMouseDown={() => setOpen(false)}>
          <aside
            className="ai-drawer"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ask-ai-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <AskAIExperience compact onClose={closePanel} />
          </aside>
        </div>
      )}
    </>
  );
}

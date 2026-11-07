import React, { useEffect } from 'react';

export interface PanelProps {
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
}

/**
 * The side panel (v0.5 remodel): a holo-glass sheet sliding in from the right
 * with a gradient hairline edge. Escape closes; role/aria contracts kept for
 * tests + a11y ("Fairy side panel", "Close panel").
 */
export function Panel({ open, onClose, children }: PanelProps): React.ReactElement | null {
  // Escape closes the dialog — standard a11y affordance for side panels.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <aside
      role="dialog"
      aria-label="Fairy side panel"
      className="f-holo f-hairline f-panel-enter"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 400,
        height: '100vh',
        boxSizing: 'border-box',
        color: 'var(--f-text)',
        borderLeft: '1px solid rgba(87, 209, 255, 0.35)',
        boxShadow: '-1px 0 0 rgba(87,209,255,0.4), -16px 0 44px rgba(0,0,0,0.65)',
        padding: 16,
        overflow: 'auto',
      }}
    >
      <button type="button" onClick={onClose} aria-label="Close panel" className="f-btn" style={{ float: 'right', padding: '2px 8px', marginLeft: 8 }}>
        ×
      </button>
      {children}
    </aside>
  );
}

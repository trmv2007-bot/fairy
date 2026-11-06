import React, { useEffect } from 'react';

export interface PanelProps {
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
}

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
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 380,
        height: '100vh',
        boxSizing: 'border-box',
        background: 'rgba(7, 14, 10, 0.97)',
        color: 'var(--f-text)',
        borderLeft: '1px solid var(--f-line)',
        boxShadow: '-1px 0 0 rgba(61,255,156,0.35), -10px 0 36px rgba(0,0,0,0.6)',
        padding: 16,
        overflow: 'auto',
      }}
    >
      <button type="button" onClick={onClose} aria-label="Close panel" className="f-btn" style={{ float: 'right', padding: '2px 8px' }}>
        ×
      </button>
      {children}
    </aside>
  );
}

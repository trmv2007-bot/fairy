import React from 'react';

export interface PanelProps {
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
}

export function Panel({ open, onClose, children }: PanelProps): React.ReactElement | null {
  if (!open) return null;
  return (
    <aside
      role="dialog"
      aria-label="Fairy side panel"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 360,
        height: '100vh',
        background: '#0f172a',
        color: '#e2e8f0',
        padding: 16,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
        overflow: 'auto',
      }}
    >
      <button type="button" onClick={onClose} aria-label="Close panel" style={{ float: 'right' }}>
        ×
      </button>
      {children}
    </aside>
  );
}

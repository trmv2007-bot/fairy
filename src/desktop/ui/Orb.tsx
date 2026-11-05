import React from 'react';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'working' | 'approval-needed' | 'paused' | 'error';

const COLORS: Record<OrbState, string> = {
  idle: '#7c8cff',
  listening: '#4ade80',
  thinking: '#fbbf24',
  working: '#38bdf8',
  'approval-needed': '#f87171',
  paused: '#94a3b8',
  error: '#ef4444',
};

export interface OrbProps {
  state: OrbState;
  label?: string;
  onClick?: () => void;
}

export function Orb({ state, label, onClick }: OrbProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={`Fairy orb: ${state}${label ? ' - ' + label : ''}`}
      onClick={onClick}
      style={{
        width: 64,
        height: 64,
        borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.2)',
        background: COLORS[state],
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
      }}
    >
      {state}
    </button>
  );
}

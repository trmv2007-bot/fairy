import React from 'react';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'working' | 'approval-needed' | 'paused' | 'error';

const COLORS: Record<OrbState, string> = {
  idle: 'var(--f-green)',
  listening: '#4ade80',
  thinking: 'var(--f-warn)',
  working: 'var(--f-cyan)',
  'approval-needed': 'var(--f-danger)',
  paused: '#93a89c',
  error: 'var(--f-danger)',
};

/** Mono caption shown next to the eye, Fairy-voice readout per state. */
export const STATE_LABELS: Record<OrbState, string> = {
  idle: 'online',
  listening: 'listening',
  thinking: 'processing',
  working: 'executing',
  'approval-needed': 'awaiting approval',
  paused: 'standby',
  error: 'malfunction',
};

export interface OrbProps {
  state: OrbState;
  label?: string;
  onClick?: () => void;
}

/** The Fairy eye: a glowing iris that watches, blinks, and changes hue with state. */
export function Orb({ state, label, onClick }: OrbProps): React.ReactElement {
  const c = COLORS[state];
  const busy = state === 'thinking' || state === 'working';
  return (
    <button
      type="button"
      aria-label={`Fairy orb: ${state}${label ? ' - ' + label : ''}`}
      onClick={onClick}
      title={`Fairy: ${STATE_LABELS[state]}`}
      style={{
        width: 72,
        height: 72,
        borderRadius: '50%',
        position: 'relative',
        cursor: 'pointer',
        flexShrink: 0,
        background: 'radial-gradient(circle at 50% 42%, #10241a 0%, #060d09 72%)',
        border: `2px solid ${c}`,
        boxShadow: `0 0 16px ${c}44, inset 0 0 14px ${c}22`,
      }}
    >
      {/* iris ring */}
      <span style={{ position: 'absolute', inset: 12, borderRadius: '50%', border: `1px solid ${c}55` }} />
      {/* lens */}
      <span
        style={{
          position: 'absolute', left: 9, right: 9, top: '50%', height: 26,
          transform: 'translateY(-50%)', borderRadius: '50%',
          border: `1.5px solid ${c}`,
          background: `linear-gradient(180deg, ${c}26, transparent 75%)`,
        }}
      />
      {/* pupil (blinks; races while busy) */}
      <span
        className={busy ? 'f-pupil f-pupil-fast' : 'f-pupil'}
        style={{
          position: 'absolute', left: '50%', top: '50%', width: 12, height: 12,
          borderRadius: '50%', background: c,
          boxShadow: `0 0 10px ${c}, 0 0 22px ${c}66`,
        }}
      />
    </button>
  );
}

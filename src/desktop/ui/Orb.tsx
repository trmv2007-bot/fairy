import React from 'react';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'working' | 'approval-needed' | 'paused' | 'error';

const COLORS: Record<OrbState, string> = {
  idle: 'var(--f-acc)',
  listening: '#6db3ff',
  thinking: 'var(--f-warn)',
  working: 'var(--f-cyan)',
  'approval-needed': 'var(--f-danger)',
  paused: '#8fa0b8',
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

export interface EyeMarkProps {
  /** Rendered pixel size (square viewBox, scales cleanly). */
  size?: number;
  /** State hue — any CSS color. */
  color: string;
  /** Pupil races while busy. */
  busy?: boolean;
  /** Unique SVG gradient id (Orb passes its state so tests can key on it). */
  gradId: string;
}

/**
 * Canon Fairy emblem (official key visual): a BLUE concentric eye-mandala on a
 * dark navy CRT — segmented outer ring, iris ring, glowing pupil (Youkai gets
 * the red one). Shared by the Orb widget and the boot sequence so the emblem
 * is identical at every scale.
 */
export function EyeMark({ size = 62, color, busy = false, gradId }: EyeMarkProps): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <radialGradient id={gradId} cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="#eaf2ff" stopOpacity="0.95" />
          <stop offset="55%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor="#04060e" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* segmented outer mandala ring */}
      <circle cx="24" cy="24" r="20" fill="none" stroke={color} strokeWidth="2.2" strokeDasharray="5.5 4" opacity="0.95" />
      {/* mandala notches */}
      <circle cx="24" cy="24" r="15.5" fill="none" stroke={color} strokeWidth="1.2" strokeDasharray="2.5 6" opacity="0.6" />
      {/* iris */}
      <circle cx="24" cy="24" r="10" fill={`url(#${gradId})`} stroke={color} strokeWidth="1.4" opacity="0.9" />
      {/* pupil: blinks (races while busy) */}
      <circle
        cx="24"
        cy="24"
        r="3.6"
        className={busy ? 'f-pupil f-pupil-fast' : 'f-pupil'}
        fill={color}
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
    </svg>
  );
}

export interface OrbProps {
  state: OrbState;
  label?: string;
  onClick?: () => void;
}

/**
 * The desktop-widget eye. The pupil blinks and races while busy; hue tracks
 * state. aria-label contract ("Fairy orb: <state>") is kept for tests + a11y.
 */
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
        width: 84,
        height: 72,
        borderRadius: 10,
        cursor: 'pointer',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 4,
        boxSizing: 'border-box',
        background: 'radial-gradient(circle at 50% 42%, #0d1830 0%, #04060e 74%)',
        border: `2px solid ${c}`,
        boxShadow: `0 0 16px ${c}44, inset 0 0 14px ${c}22`,
      }}
    >
      <EyeMark color={c} busy={busy} gradId={`f-iris-${state}`} />
    </button>
  );
}

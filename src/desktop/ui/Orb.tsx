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

/** Mono caption shown next to the face, Fairy-voice readout per state. */
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

/**
 * Canon Fairy avatar (v1.0 era): a dot-matrix pixel face on a dark round
 * screen — two rectangular eyes, one wide flat mouth — rendered as a lit-pixel
 * matrix. '#' = lit pixel. The face keeps the aria-label contract of the old
 * orb (tests + screen readers unchanged).
 */
const FACE = [
  '.........',
  '.##...##.',
  '.##...##.',
  '.........',
  '.#######.',
  '.........',
  '.........',
] as const;

const COLS = FACE[0]!.length;
const EYE_CELLS = new Set<string>([
  '1,1', '2,1', '6,1', '7,1',
  '1,2', '2,2', '6,2', '7,2',
]);

/** The Fairy face: dot-matrix pixels that blink (eyes) and pulse (mouth, while busy). */
export function Orb({ state, label, onClick }: OrbProps): React.ReactElement {
  const c = COLORS[state];
  const busy = state === 'thinking' || state === 'working';
  const cells: React.ReactElement[] = [];
  FACE.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const key = `${x},${y}`;
      const isEye = EYE_CELLS.has(key);
      const isMouth = ch === '#' && y === 4;
      const lit = ch === '#';
      const cls = !lit
        ? 'f-px f-px-off'
        : isEye
          ? 'f-px f-px-eye'
          : isMouth && busy
            ? 'f-px f-px-mouth'
            : 'f-px';
      cells.push(
        <span
          key={key}
          className={cls}
          style={{
            width: 7,
            height: 7,
            background: lit ? c : 'rgba(111, 207, 161, 0.10)',
            boxShadow: lit ? `0 0 5px ${c}88` : 'none',
            animationDelay: isEye ? `${(x * 13 + y * 7) % 90}ms` : undefined,
          }}
        />,
      );
    });
  });
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
        display: 'grid',
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        alignContent: 'center',
        justifyItems: 'center',
        gap: 1,
        padding: 6,
        boxSizing: 'border-box',
        background: 'radial-gradient(circle at 50% 42%, #10241a 0%, #060d09 72%)',
        border: `2px solid ${c}`,
        boxShadow: `0 0 16px ${c}44, inset 0 0 14px ${c}22`,
      }}
    >
      {cells}
    </button>
  );
}

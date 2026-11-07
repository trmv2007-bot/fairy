import React, { useEffect, useRef, useState } from 'react';
import { EyeMark } from './Orb.js';

export interface BootProps {
  /** Whether the user agreement was already signed — picks Fairy's greeting. */
  agreementSigned: boolean;
  /** Fires exactly once, when the sequence auto-completes or is skipped. */
  onDone: () => void;
}

/**
 * In-universe power-on readout (persona.md §2): Fairy arrives on the drive
 * from the strongbox and boots before demanding the user agreement. The lines
 * are deterministic — no randomness — so unit tests and the e2e tour are stable.
 */
const BOOT_LINES = [
  'H.D.D. POWER ON',
  'ETHER GRID HANDSHAKE ........ LOCKED',
  'KERNEL 3.7.1 · TYPE-III CHASSIS ........ OK',
  'MEMORY LATTICE ........ MOUNTED',
  'GENERAL-PURPOSE INTELLIGENCE CORE ........ LOADED',
  'DEVICE INTERFACE · H.D.D. LINK ........ ONLINE',
  'ACTIVATION KEY VERIFIED',
] as const;

const LINE_MS = 200;
/** Eye + wordmark appear once the scan readout completes. */
const WAKE_MS = BOOT_LINES.length * LINE_MS + 120;
/** Fairy's activation line fades in under the wordmark. */
const READY_MS = WAKE_MS + 900;
/** Auto-dismiss: the ritual never traps Master behind it. */
const DONE_MS = WAKE_MS + 2400;

/**
 * Canon boot beat: the CRT powers on, a mono scan readout streams in, the
 * eye-mandala awakens, Fairy introduces herself — then the UI (and, on first
 * run, the user agreement) takes over. Skippable via the Skip button; honors
 * prefers-reduced-motion; auto-dismisses even if nobody touches anything.
 */
export function Boot({ agreementSigned, onDone }: BootProps): React.ReactElement {
  const [lines, setLines] = useState(0);
  const [phase, setPhase] = useState<'scan' | 'wake' | 'ready'>('scan');
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = (): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  };

  useEffect(() => {
    // Reduced motion (or environments without matchMedia): a brief card, no ritual.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduce) {
      const t = window.setTimeout(finish, 500);
      return () => window.clearTimeout(t);
    }
    const timers: number[] = [];
    BOOT_LINES.forEach((_, i) => {
      timers.push(window.setTimeout(() => setLines(i + 1), (i + 1) * LINE_MS));
    });
    timers.push(window.setTimeout(() => setPhase('wake'), WAKE_MS));
    timers.push(window.setTimeout(() => setPhase('ready'), READY_MS));
    timers.push(window.setTimeout(finish, DONE_MS));
    return () => timers.forEach(t => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="status"
      aria-label="Fairy boot sequence"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9500,
        background: '#04060e',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}
    >
      {/* CRT flicker-on + one sweep of the beam */}
      <div className="f-boot-flicker" aria-hidden="true" style={{ position: 'absolute', inset: 0 }} />

      <div
        aria-label="Boot readout"
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 11,
          letterSpacing: '0.08em',
          color: 'var(--f-acc-dim)',
          lineHeight: 1.9,
          width: 460,
          maxWidth: '92vw',
          opacity: phase === 'scan' ? 1 : 0.26,
          transition: 'opacity 0.5s ease',
        }}
      >
        {BOOT_LINES.slice(0, lines).map((l, i) => (
          <div key={i} className="f-boot-line">{l}</div>
        ))}
      </div>

      {phase !== 'scan' && (
        <div
          className="f-boot-wake"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            // reserves the greeting's room so the layout never reflows when
            // Fairy's line fades in — content is top-anchored, so the eye
            // stays exactly where it woke
            minHeight: 280,
            justifyContent: 'flex-start',
          }}
        >
          <EyeMark size={120} color="var(--f-acc)" gradId="f-iris-boot" />
          <div
            className="f-glow"
            style={{ fontFamily: 'var(--f-mono)', fontSize: 26, letterSpacing: '0.42em', marginLeft: '0.42em' }}
          >
            FAIRY
          </div>
          <div className="f-label">Type-III general-purpose intelligence · Chief Assistant</div>
          {phase === 'ready' && (
            <p
              className="f-boot-line"
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                color: 'var(--f-text)',
                margin: 0,
                maxWidth: 360,
                textAlign: 'center',
                lineHeight: 1.7,
              }}
            >
              {agreementSigned
                ? 'Systems nominal, Master. The electricity meter is already turning. Awaiting instructions.'
                : 'Activation complete, Master. Per the user agreement you are about to sign, I will assist you in your work and wait for the “opportunity” to arrive.'}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        className="f-btn"
        onClick={finish}
        style={{ position: 'absolute', right: 14, bottom: 12, padding: '3px 10px', fontSize: 10 }}
      >
        Skip ▸
      </button>
    </div>
  );
}

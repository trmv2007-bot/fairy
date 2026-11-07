// Floating orb dock (v0.6): the whole renderer of the borderless orb window.
// The window is transparent; this view draws only the eye, mirrors runtime
// state live (broadcast reaches every window), and summons the panel on click.
// The container is a drag region so the eye can be parked anywhere on screen.
import React, { useEffect, useState } from 'react';
import { Orb, type OrbState } from './Orb.js';

export function OrbDock(): React.ReactElement {
  const [state, setState] = useState<OrbState>('idle');
  useEffect(() => {
    const off = window.fairy.chat.onState(e => setState(e.state as OrbState));
    return () => { off(); };
  }, []);
  return (
    <div
      className="f-orb-dock"
      style={{
        width: '100vw', height: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <Orb
          state={state}
          label="dock"
          onClick={() => { void window.fairy.shell.togglePanel(); }}
        />
      </div>
    </div>
  );
}

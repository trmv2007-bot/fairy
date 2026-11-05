import React, { useState } from 'react';
import { Orb } from './Orb.js';
import { Panel } from './Panel.js';

export function App(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'listening' | 'thinking' | 'working' | 'approval-needed' | 'paused' | 'error'>('idle');
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <Orb state={state} onClick={() => setOpen(true)} />
      <Panel open={open} onClose={() => setOpen(false)}>
        <h2>Fairy</h2>
        <p>Strong, dry, competent. (T02 scaffold)</p>
        <button type="button" onClick={() => setState('paused')}>Pause all</button>
        <button type="button" onClick={() => setState('idle')}>Resume</button>
      </Panel>
    </div>
  );
}

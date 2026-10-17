// P0's throwaway apps. They exist to prove the workspace: a long list that scrolls natively (for
// two-finger gestures over scrolling content), a text field (keyboard, and that typed text survives
// moves), a counter (React state survives moves), and a container band (a host's own UI).

import { useState } from 'react';

export function ProbeList({ seed, title }: { seed: number; title: string }) {
  const items = Array.from({ length: 80 }, (_, i) => `${title} · item ${i + 1}`);
  return (
    <div className="probe probe-list" data-seed={seed}>
      <ul>
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

export function ProbeField({ title }: { title: string }) {
  const [text, setText] = useState('');
  return (
    <div className="probe probe-field">
      <label>
        <span className="ds-small ds-muted">{title}</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Type here; it stays when the panel moves." />
      </label>
    </div>
  );
}

export function ProbeCounter({ title }: { title: string }) {
  const [n, setN] = useState(0);
  return (
    <div className="probe probe-counter">
      <span className="ds-small ds-muted">{title}</span>
      <span className="ds-display probe-count" data-count={n}>
        {n}
      </span>
      <button type="button" className="ds-btn ds-btn--primary" onClick={() => setN(n + 1)}>
        Add one
      </button>
    </div>
  );
}

export function ContainerBand({ title, count }: { title: string; count: number }) {
  return (
    <div className="probe band">
      <strong>{title}</strong>
      <span className="ds-small ds-muted">
        {count} {count === 1 ? 'app' : 'apps'} inside
      </span>
    </div>
  );
}

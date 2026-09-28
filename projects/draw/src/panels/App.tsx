// Draw's shell. P0-M2: the top bar and the canvas, showing a built-in sample through the safe
// sink. Zoom, pan, the code panel and the tools arrive in M3 and M4 (see the plan in the vault's
// _audit/).

import { Canvas } from './Canvas.tsx';

export function App() {
  return (
    <div className="draw ds-app">
      <header className="draw-bar">
        <span className="draw-name">Draw</span>
        <span className="draw-badge ds-small">preview</span>
      </header>
      <main className="draw-canvas">
        <Canvas />
      </main>
    </div>
  );
}

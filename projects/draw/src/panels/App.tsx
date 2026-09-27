// Draw's shell. P0-M0 ships the frame only: the top bar and a status page. The canvas, the code
// panel and the tools arrive in P0-M2 to M4 (see the plan in the vault's _audit/).

export function App() {
  return (
    <div className="draw ds-app">
      <header className="draw-bar">
        <span className="draw-name">Draw</span>
        <span className="draw-badge ds-small">preview</span>
      </header>
      <main className="ds-page">
        <h1 className="ds-title">Draw</h1>
        <p className="ds-sub">An SVG-native design editor, built from SVG Lab.</p>
        <p>
          This page is live so every build is tested on Safari&rsquo;s engine, but Draw isn&rsquo;t
          ready yet. Next: open any SVG safely, zoom and pan it, and edit its numbers and colors in
          the live code panel.
        </p>
        <p className="ds-muted ds-small">Not listed on the launcher until Release 1.</p>
      </main>
    </div>
  );
}

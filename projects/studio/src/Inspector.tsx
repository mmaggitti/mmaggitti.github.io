import { ancestors, box, isElement, keyStyles, label, round } from './dom';
import { session, useFrameVersion } from './frame';
import { selection } from './selection';
import { useStore } from './store';

const TEXT_PREVIEW = 160;

export function Inspector() {
  useFrameVersion('layout');
  const el = useStore(selection);

  if (!el || !el.isConnected) {
    return (
      <p className="ds-muted studio-empty">
        Turn on <strong>Select</strong> and tap anything on the page, or tap a row in the tree.
      </p>
    );
  }

  const b = box(el);
  const path = ancestors(el).filter(isElement);
  // Rendered text (innerText), not textContent, which would include <script> and <style> source.
  const rendered = 'innerText' in el ? (el as HTMLElement).innerText : el.textContent;
  const text = (rendered ?? '').replace(/\s+/g, ' ').trim();
  const notRendered = b !== null && b.rect.width === 0 && b.rect.height === 0;

  return (
    <div className="inspect">
      <nav className="crumbs" aria-label="Ancestors">
        {path.map((a, i) => (
          <button
            key={i}
            type="button"
            className="crumb"
            aria-current={a === el ? 'true' : undefined}
            onClick={() => {
              selection.set(a);
              session.reveal(a);
            }}
          >
            {label(a)}
          </button>
        ))}
      </nav>

      <h2 className="ds-heading inspect-title">{label(el)}</h2>
      {notRendered && <p className="ds-muted inspect-note">Not rendered: it takes up no space on the page.</p>}

      <dl className="ds-list inspect-attrs">
        <div className="ds-row">
          <dt>tag</dt>
          <dd>{el.localName}</dd>
        </div>
        {Array.from(el.attributes).map((a) => (
          <div className="ds-row" key={a.name}>
            <dt>{a.name}</dt>
            <dd>{a.value || '""'}</dd>
          </div>
        ))}
      </dl>

      {b && (
        <div className="boxm" role="img" aria-label={boxSummary(b)}>
          <div className="boxm-layer boxm-margin">
            <span className="boxm-name">margin</span>
            <Sides v={b.margin} />
            <div className="boxm-layer boxm-border">
              <span className="boxm-name">border</span>
              <Sides v={b.border} />
              <div className="boxm-layer boxm-padding">
                <span className="boxm-name">padding</span>
                <Sides v={b.padding} />
                <div className="boxm-content ds-num">
                  {round(b.rect.width - b.border[1] - b.border[3] - b.padding[1] - b.padding[3])} ×{' '}
                  {round(b.rect.height - b.border[0] - b.border[2] - b.padding[0] - b.padding[2])}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <h3 className="inspect-sub">Styles</h3>
      <dl className="ds-list inspect-styles">
        {keyStyles(el).map(([k, v]) => (
          <div className="ds-row" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      {text && (
        <>
          <h3 className="inspect-sub">Text</h3>
          <p className="inspect-text">{text.length > TEXT_PREVIEW ? `${text.slice(0, TEXT_PREVIEW)}…` : text}</p>
        </>
      )}
    </div>
  );
}

function boxSummary(b: NonNullable<ReturnType<typeof box>>): string {
  const sides = (v: number[]) => v.map(round).join(' ');
  return `Box model, top right bottom left. Margin ${sides(b.margin)}. Border ${sides(b.border)}. Padding ${sides(b.padding)}.`;
}

/** One layer's four side values, placed on its four edges. */
function Sides({ v }: { v: [number, number, number, number] }) {
  const fmt = (n: number) => (n ? round(n) : '–');
  return (
    <>
      <span className="boxm-v boxm-t ds-num">{fmt(v[0])}</span>
      <span className="boxm-v boxm-r ds-num">{fmt(v[1])}</span>
      <span className="boxm-v boxm-b ds-num">{fmt(v[2])}</span>
      <span className="boxm-v boxm-l ds-num">{fmt(v[3])}</span>
    </>
  );
}

import { box, label, round } from './dom';
import { session, useFrameVersion } from './frame';
import { selection } from './selection';
import { useStore } from './store';

// Drawn in the studio, over the frame. The overlay box is laid exactly over the iframe (same
// inset, frame has no border), so the frame's viewport coordinates are the overlay's coordinates:
// getBoundingClientRect() inside the frame needs no offset math. Keep it that way — a second
// origin between the two layers is how overlay editors drift out of alignment.
// Geometry is px from the live layout, so it lives here in inline styles, not in CSS.
//
// Known limits: an inline element that wraps is outlined as one union box; a transformed element
// gets its outline but no margin/padding shading (those are pre-transform values).

const pos = (n: number) => Math.max(0, n);

export function Highlight() {
  useFrameVersion('layout');
  const el = useStore(selection);
  const win = session.window;
  if (!el || !el.isConnected || !win) return null;
  const b = box(el);
  if (!b) return null;
  const { rect: r, margin, border: bo, padding: p } = b;

  // Not rendered (display:none, <head>, <script>…): nothing to outline.
  if (r.width === 0 && r.height === 0) return null;
  // Entirely scrolled out of the frame: nothing to show here either.
  const viewW = win.innerWidth;
  const viewH = win.innerHeight;
  if (r.bottom < 0 || r.top > viewH || r.right < 0 || r.left > viewW) return null;

  const m = margin.map(pos); // negative margins pull neighbors in; there is no band to shade
  const transformed = win.getComputedStyle(el).transform !== 'none';

  const marginBox = {
    left: r.left - m[3],
    top: r.top - m[0],
    width: r.width + m[1] + m[3],
    height: r.height + m[0] + m[2],
    borderWidth: `${m[0]}px ${m[1]}px ${m[2]}px ${m[3]}px`,
  };
  const paddingBox = {
    left: r.left + bo[3],
    top: r.top + bo[0],
    width: pos(r.width - bo[1] - bo[3]),
    height: pos(r.height - bo[0] - bo[2]),
    borderWidth: `${p[0]}px ${p[1]}px ${p[2]}px ${p[3]}px`,
  };
  const borderBox = { left: r.left, top: r.top, width: r.width, height: r.height };

  // The chip sits above the element when there is room, else just inside its top edge. It is
  // anchored at the element's left and slid back left by however much it would overflow — its
  // own width is only known to CSS, hence translateX with a percentage.
  const top = r.top - m[0] >= 28 ? r.top - m[0] - 26 : Math.max(r.top, 0) + 2;
  const left = Math.max(2, r.left);
  const chip = { left, top, transform: `translateX(min(0px, calc(${viewW - left - 2}px - 100%)))` };

  return (
    <div className="studio-overlay" aria-hidden="true">
      {!transformed && <div className="hl hl-margin" style={marginBox} />}
      {!transformed && <div className="hl hl-padding" style={paddingBox} />}
      <div className="hl hl-border" style={borderBox} />
      <div className="hl-chip" style={chip}>
        {label(el)} <span className="hl-size">{round(r.width)}×{round(r.height)}</span>
      </div>
    </div>
  );
}

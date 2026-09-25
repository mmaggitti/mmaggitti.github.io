import { useEffect, useRef, useState } from 'react';
import { session } from './frame';
import { Highlight } from './Highlight';
import { picking, selection, sheetTab } from './selection';
import { Sheet } from './Sheet';
import { useStore } from './store';

interface Page {
  path: string;
  title: string;
}

const DEFAULT_PAGE = '/hello/';
const BASE = import.meta.env.BASE_URL; // '/studio/' when built, '/' under the dev server

/** Is this path the studio itself? A studio inside a studio is never what you want. */
function isStudio(pathname: string): boolean {
  return BASE !== '/' && (pathname === BASE.slice(0, -1) || pathname.startsWith(BASE));
}

/** Only same-origin paths, and never the studio itself. */
function safePage(raw: string | null): string {
  if (!raw) return DEFAULT_PAGE;
  try {
    const url = new URL(raw, location.origin);
    if (url.origin !== location.origin || isStudio(url.pathname)) return DEFAULT_PAGE;
    return url.pathname + url.search + url.hash;
  } catch {
    return DEFAULT_PAGE;
  }
}

export function App() {
  const [pages, setPages] = useState<Page[]>([]);
  // Choosing a page remounts the iframe (new key), so it always navigates — even to the page it
  // was on before an in-frame link or a back swipe moved it. `current` follows the frame.
  const [nav, setNav] = useState(() => ({ src: safePage(new URLSearchParams(location.search).get('page')), n: 0 }));
  const [current, setCurrent] = useState(nav.src);
  const frame = useRef<HTMLIFrameElement>(null);
  const pick = useStore(picking);
  const selected = useStore(selection);

  useEffect(() => {
    fetch('/pages.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Page[]) => setPages(list))
      .catch(() => setPages([]));
  }, []);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    session.bind(el, (doc) => {
      selection.set(null);
      if (!doc) return; // off-site or not loaded yet: nothing to inspect
      const loc = doc.location;
      if (isStudio(loc.pathname)) {
        loc.replace('/'); // a link inside the page led to the studio; go to the launcher instead
        return;
      }
      const path = loc.pathname + loc.search + loc.hash;
      setCurrent(path);
      history.replaceState(null, '', `?page=${encodeURIComponent(path)}`);
    });
    return () => session.unbind();
  }, [nav]);

  useEffect(() => {
    session.setPicker(
      pick
        ? (el) => {
            selection.set(el);
            sheetTab.set('inspect');
          }
        : null,
    );
  }, [pick]);

  useEffect(() => session.watch(selected), [selected]);

  useEffect(() => {
    const onResize = () => session.bump('layout');
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  const options = pages.some((p) => p.path === current) ? pages : [...pages, { path: current, title: current }];

  return (
    <div className="studio">
      <header className="studio-bar">
        <select
          className="studio-page"
          aria-label="Page"
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value);
            setNav((n) => ({ src: e.target.value, n: n.n + 1 }));
          }}
        >
          {options.map((p) => (
            <option key={p.path} value={p.path}>
              {p.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ds-btn studio-select"
          aria-pressed={pick}
          onClick={() => picking.set(!pick)}
        >
          Select
        </button>
      </header>
      <div className="studio-stage">
        {/* The frame and its overlay share one box, so frame coordinates are overlay coordinates. */}
        <div className="studio-canvas" data-picking={pick || undefined}>
          <iframe
            key={nav.n}
            ref={frame}
            className="studio-frame"
            src={nav.src}
            title="Page being inspected"
            onLoad={session.check}
          />
          <Highlight />
        </div>
        <Sheet />
      </div>
    </div>
  );
}

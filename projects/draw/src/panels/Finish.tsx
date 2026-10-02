// The Finish sheet (P1-M5): the drawing as PNG icons at 16 to 1024 px, each on light, dark and the
// canvas's checkerboard; SVG Lab's Pixels and vector comparison (the Vector lesson's two panes, its
// 16, 32 and 64 chips, the pixel grid and the captions); and PNG, the icon set or 1×, 2× or 3× the
// artboard, shared inside the tap or downloaded one file per tap.
//
// - Every PNG is drawn from one source, made when the sheet opens: Clean's copy with its text as paths
//   (export/png.ts), each file its PNG copy at its size (no <foreignObject>, the root sized to the
//   file; the copy is parsed once for the sheet, the Vector pane's too, and each file writes only its
//   width and height), rasterized only by src/platform/raster.ts, one at a time. The icon set is made at once (it
//   is also the previews); 1×, 2× and 3× when picked. Share reads "Preparing…" and is disabled until
//   every file of the choice is ready, so a tap shares them inside its own activation.
// - The sheet shows pictures of the drawing (PNGs as blob URLs, and the Vector pane's own SVG as an
//   image, which runs nothing and loads nothing), never its DOM. It reads the editor's artboard and
//   the document's shape count, never the canvas.
// - The previews show each PNG's own pixels (image-rendering: pixelated) at its own size, side by side
//   while three fit the sheet's width and stacked beyond; one wider than the sheet is shown smaller and
//   says at what share.
// - The comparison fits the artboard into 16, 32 or 64 dots (32 first, as the lab's), stretched to the
//   pane without smoothing; a faint grid outlines each dot where one spans 12 device pixels or more
//   (the lab's rule); the panes don't zoom (a pinch zooms the canvas).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Editor } from '../editor.ts';
import type { Workspace } from '../workspace.ts';
import { DOTS, FIRST_DOTS, ICON_SIZES, SCALES, dotsCaption, gridShows, pngSize, shapeCount, shapesCaption, type PixelSize, type PngChoice } from '../../../../engine/export/raster.ts';
import { pngCopier, type PngCopies } from '../../../../engine/export/png-source.ts';
import { clampedNote, freshCaps, makePng, pngName, type MadePng } from '../export/png.ts';
import { previewUrl, rasterize, revokeAll } from '../platform/raster.ts';
import { canShareFiles, downloadFile, shareFiles } from '../platform/share.ts';
import { useStore } from './store.ts';

/** A file made for the sheet: its PNG, its blob URL and the File the share sheet takes. */
interface Made extends MadePng {
  url: string;
  file: File;
}
type Result = Made | { refused: string };
type Choice = 'icons' | 1 | 2 | 3;

const CHOICES: { key: Choice; label: string }[] = [
  { key: 'icons', label: 'Icon set' },
  ...SCALES.map((k) => ({ key: k as Choice, label: `${k}×` })),
];
const BACKS = [
  { key: 'light', label: 'On light' },
  { key: 'dark', label: 'On dark' },
  { key: 'checker', label: 'On the checkerboard' },
] as const;
/** SVG Lab's grid colour (paintPx). */
const GRID = 'rgba(35, 31, 32, 0.13)';

const choiceOf = (c: Choice, n?: number): PngChoice => (c === 'icons' ? { icon: n! } : { scale: c });

export function Finish({ workspace, editor }: { workspace: Workspace; editor: Editor }) {
  const unparsed = useStore(workspace.unparsed);
  // Read once: the sheet is modal, so the drawing can't change while it is open.
  const [doc] = useState(() => editor.doc);
  const [board] = useState(() => editor.board());
  if (!doc) return <p className="ds-muted">{unparsed ? 'A file that isn’t well-formed can’t be made into a PNG.' : 'Nothing is open.'}</p>;
  if (!board || !(board.width > 0 && board.height > 0)) return <p className="ds-muted draw-finish-none">This drawing has no artboard: give its root a viewBox, or a width and a height, to make PNGs of it.</p>;
  return <FinishBody workspace={workspace} board={board} shapes={shapeCount(doc)} />;
}

function FinishBody({ workspace, board, shapes }: { workspace: Workspace; board: { width: number; height: number }; shapes: number }) {
  const name = workspace.fileName;
  // The PNG source's notes, and its copies for every file of the sheet (one parse).
  const [source, setSource] = useState<{ notes: string[]; copies: PngCopies } | null>(null);
  const [icons, setIcons] = useState<(Result | undefined)[]>(() => ICON_SIZES.map(() => undefined));
  const [scaled, setScaled] = useState<Partial<Record<number, Result>>>({});
  const [pixels, setPixels] = useState<Partial<Record<number, Result>>>({});
  const [res, setRes] = useState(FIRST_DOTS);
  const [choice, setChoice] = useState<Choice>('icons');
  const [busy, setBusy] = useState(false);
  const [unshared, setUnshared] = useState(false);
  const alive = useRef(true);
  const caps = useRef(freshCaps());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const link = useRef<HTMLAnchorElement>(null);
  const sharing = useRef(false);

  // One file, after the ones before it (one rasterization at a time), unless the sheet has closed.
  const make = (copies: PngCopies, wanted: PixelSize, fileName: string): Promise<Result | null> => {
    const job = queue.current.then(async (): Promise<Result | null> => {
      if (!alive.current) return null;
      const r = await makePng(copies, wanted, fileName, rasterize, caps.current);
      if (!alive.current) return null;
      if ('refused' in r) return r;
      return { ...r, url: previewUrl(r.blob), file: new File([r.blob], r.name, { type: 'image/png' }) };
    });
    queue.current = job.catch(() => null);
    return job;
  };

  useEffect(() => {
    alive.current = true;
    void (async () => {
      const src = await workspace.pngSource();
      if (!alive.current || !src) return;
      const copies = pngCopier(src.text);
      setSource({ notes: src.notes, copies });
      ICON_SIZES.forEach((n, i) => {
        void make(copies, pngSize(board, { icon: n }), pngName(name, { icon: n })).then((r) => r && setIcons((was) => was.map((x, j) => (j === i ? r : x))));
      });
    })();
    return () => {
      alive.current = false;
      revokeAll();
    };
    // Made once per visit: the drawing can't change while the sheet is open.
  }, []);

  // The comparison's dots, made when chosen (32 first).
  useEffect(() => {
    if (!source || pixels[res]) return;
    void make(source.copies, { w: res, h: res }, `${res}.png`).then((r) => r && setPixels((was) => ({ ...was, [res]: r })));
  }, [source, res]);

  // 1×, 2× or 3×, made when picked.
  useEffect(() => {
    if (!source || choice === 'icons' || scaled[choice]) return;
    const k = choice;
    void make(source.copies, pngSize(board, { scale: k }), pngName(name, { scale: k })).then((r) => r && setScaled((was) => ({ ...was, [k]: r })));
  }, [source, choice]);

  const chosen: (Result | undefined)[] = choice === 'icons' ? icons : [scaled[choice]];
  const ready = chosen.every((r) => r !== undefined) ? (chosen as Result[]) : null;
  const files = ready?.filter((r): r is Made => !('refused' in r)) ?? [];
  const downloads = !!ready && files.length > 0 && (unshared || !canShareFiles(files.map((m) => m.file)));

  const share = () => {
    if (!ready || !files.length || sharing.current) return;
    sharing.current = true;
    const asked = shareFiles(files.map((m) => m.file)); // first: nothing awaited before it (the tap's activation)
    setBusy(true);
    void asked.then(async (outcome) => {
      if (outcome === 'unshared') setUnshared(true);
      else if (outcome === 'shared') await workspace.exported({ fileName: files.length === 1 ? files[0].name : `${files.length} PNGs`, kind: 'png' }, 'shared');
      sharing.current = false;
      if (alive.current) setBusy(false);
    });
  };
  const download = (m: Made) => {
    downloadFile(link.current!, m.file);
    void workspace.exported({ fileName: m.name, kind: 'png' }, 'downloaded', false);
  };

  const notes = [
    ...(source?.notes ?? []),
    ...new Set(files.flatMap((m) => m.notes)),
    ...files.filter((m) => m.clamped !== null).map((m) => clampedNote(m.name, m.size, m.clamped!)),
    ...new Set((ready ?? []).flatMap((r) => ('refused' in r ? [r.refused] : []))),
  ];
  // The Vector pane: the PNG source's own SVG as an image, scaled to the pane (sharp at any size).
  const vector = useMemo(() => {
    if (!source) return null;
    const c = source.copies(...sizeOf(pngSize(board, { icon: 1024 })));
    return 'refused' in c ? null : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.text)}`;
  }, [source, board]);
  const px = pixels[res];
  return (
    <>
      <div className="draw-finish-body">
        <Previews icons={icons} board={board} />
        <h3 className="draw-subhead">Pixels and vector</h3>
        <div className="ds-seg draw-dots" role="group" aria-label="Dots">
          {DOTS.map((d) => (
            <button key={d} type="button" aria-pressed={res === d} onClick={() => setRes(d)}>
              {d} × {d}
            </button>
          ))}
        </div>
        <div className="draw-compare">
          <figure className="draw-compare-fig">
            <Pane res={res}>{px && !('refused' in px) && <img className="draw-pane-img draw-pane-pixels" src={px.url} alt={`The drawing in ${res} × ${res} dots`} />}</Pane>
            <figcaption>
              <b>Pixels</b>
              <span className="draw-dots-caption">{dotsCaption(res)}</span>
            </figcaption>
          </figure>
          <figure className="draw-compare-fig">
            <div className="draw-pane draw-finish-checker">
              {vector && <img className="draw-pane-img draw-pane-vector" src={vector} alt="The drawing as vector" />}
            </div>
            <figcaption>
              <b>Vector</b>
              <span className="draw-shapes-caption">{shapesCaption(shapes)}</span>
            </figcaption>
          </figure>
        </div>
        <h3 className="draw-subhead">PNG</h3>
        <div className="ds-seg draw-png-choice" role="group" aria-label="PNG size">
          {CHOICES.map((c) => (
            <button key={c.key} type="button" aria-pressed={choice === c.key} disabled={busy} onClick={() => setChoice(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
        <ul className="draw-png-files">
          {(choice === 'icons' ? ICON_SIZES.map((n) => pngName(name, choiceOf(choice, n))) : [pngName(name, choiceOf(choice))]).map((fileName, i) => {
            const r = chosen[i];
            const m = r && !('refused' in r) ? r : null;
            return (
              <li key={fileName} className="draw-png-file" data-ready={m ? '' : undefined}>
                <span className="draw-png-name ds-mono ds-small">{fileName}</span>
                <span className="draw-png-size ds-small ds-muted">{m ? `${m.size.w} × ${m.size.h}` : r ? 'not made' : 'Preparing…'}</span>
                {downloads && m && (
                  <button type="button" className="ds-btn draw-png-download" onClick={() => download(m)}>
                    Download
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {notes.map((n) => (
          <p key={n} className="ds-small draw-png-note" role="note">
            {n}
          </p>
        ))}
        {unshared && <p className="ds-small draw-png-note" role="note">This browser can’t share them: download each one.</p>}
        {/* The download link downloadFile clicks: one tap, one file. */}
        <a ref={link} hidden />
      </div>
      {!downloads && (
        <div className="draw-png-footer">
          <button type="button" className="ds-btn ds-btn--primary draw-png-share" disabled={!ready || !files.length || busy} onClick={share}>
            {ready ? 'Share' : 'Preparing…'}
          </button>
        </div>
      )}
    </>
  );
}

const sizeOf = (s: PixelSize): [number, number] => [s.w, s.h];

/** The icon set's previews: each PNG on light, dark and the checkerboard, at its own size while it fits. */
function Previews({ icons, board }: { icons: (Result | undefined)[]; board: { width: number; height: number } }) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setRoom(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The cells' padding and gap, in CSS px (app.css: 0.25rem each, at the page's rem).
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 12;
  const pad = 0.25 * rem;
  const gap = 0.25 * rem;
  return (
    <div className="draw-icons" ref={box}>
      {ICON_SIZES.map((n, i) => {
        const r = icons[i];
        const size = r && !('refused' in r) ? r.size : pngSize(board, { icon: n });
        const fit = room > 0 ? Math.min(1, (room - 2 * pad) / size.w) : 1;
        const w = Math.max(1, Math.round(size.w * fit));
        const h = Math.max(1, Math.round(size.h * fit));
        const stacked = room > 0 && 3 * (w + 2 * pad) + 2 * gap > room;
        const shown = fit < 1 ? `${n} px, shown at ${Math.round(fit * 100)}%` : `${n} px`;
        const style: CSSProperties = { width: w, height: h, imageRendering: fit < 1 ? 'auto' : 'pixelated' };
        return (
          <figure key={n} className="draw-icon" data-size={n}>
            <figcaption className="draw-icon-label ds-small">{r && 'refused' in r ? `${n} px: ${r.refused}` : shown}</figcaption>
            <div className="draw-icon-trio" data-stacked={stacked || undefined}>
              {BACKS.map((b) => (
                <div key={b.key} className={`draw-icon-cell draw-icon-${b.key}${b.key === 'checker' ? ' draw-finish-checker' : ''}`} data-back={b.key}>
                  {r && !('refused' in r) ? <img className="draw-icon-img" src={r.url} alt={`${n} px, ${b.label.toLowerCase()}`} style={style} /> : <span className="draw-icon-wait" style={{ width: w, height: h }} />}
                </div>
              ))}
            </div>
          </figure>
        );
      })}
    </div>
  );
}

/** The Pixels pane: the dots' PNG stretched without smoothing, and SVG Lab's grid where a dot spans 12 device pixels or more. */
function Pane({ res, children }: { res: number; children: ReactNode }) {
  const pane = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = pane.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dpr = window.devicePixelRatio || 1;
  const grid = width > 0 && gridShows(width, dpr, res);
  let d = '';
  for (let g = 0; g <= res; g++) d += `M${g} 0V${res}M0 ${g}H${res}`;
  return (
    <div className="draw-pane draw-finish-checker" ref={pane} data-grid={grid || undefined}>
      {children}
      {grid && (
        <svg className="draw-pane-grid" viewBox={`0 0 ${res} ${res}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={d} fill="none" stroke={GRID} strokeWidth={1 / dpr} vectorEffect="non-scaling-stroke" shapeRendering="crispEdges" />
        </svg>
      )}
    </div>
  );
}

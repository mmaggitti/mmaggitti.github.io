// The modal sheets: Number, Color and Text for a code token, and Edit source for the selected
// element. Each slides up over a dimmed canvas, closes with Done, a tap on the dim or Escape, and
// sits above the on-screen keyboard (SVG Lab's visualViewport fix). A token sheet's edits apply
// live and commit as one history entry when it closes; what can't be written is refused with a
// message, never written. Edit source applies only on Apply, in one transaction.
//
// The Number sheet is SVG Lab's: − and + step (hold one to repeat: repeat.ts), the field takes a
// typed value, and a slider spans the value's range (token-edit.ts sliderRange).
//
// The Colour sheet (a code token's colour, or Inspect's style sheet over the selection, P1-M2):
// the palette, the slot's chips, an HSV square with Hue and Alpha sliders (color-picker.ts: each
// move written in the notation the value was written in), a before and now preview, and the text
// field, which always shows the text that will be written. Its body scrolls under a head that
// keeps Done. The stroke's style sheet adds the stroke-width slider, written in the same visit.
//
// P1-M4: the Text sheet's lines (a textarea: Return adds a line, each keystroke rewrites the text's
// lines into the visit's one entry, Done, the dim or Escape closes it); the Font sheet (Draw's fonts,
// each name drawn in its own 400 face, yours with Remove, the generics, and Add a font…; its groups
// come from a list, so P2's library fonts join it); and the Weight sheet (each weight by name and
// number, drawn in its own). A pick is one entry and closes the sheet.
//
// P1-M5: Edit source on the whole drawing (the code panel's Edit): the root's start tag above the field
// and its end tag below, read-only, and everything between them in the field; Apply replaces it in one
// entry. The Insert sheet (the ToolRail's Insert): SVG pasted (read through platform/files.ts pasted():
// Draw never reads the clipboard), typed, or picked from Files, put into the drawing as one group; while
// it is open its field takes a paste made anywhere.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { Editor, Sheet, SourceError } from '../editor.ts';
import type { Workspace } from '../workspace.ts';
import { decodeSvg, pasted, readFile } from '../platform/files.ts';
import { colorChoices, styleSlot, type ColorSlot } from '../color-choices.ts';
import { hueCss, pickAlpha, pickHue, pickSV, pickText, pickerCss, pickerStart, pickerText, type Picker } from '../color-picker.ts';
import { widthRange } from '../style-edit.ts';
import { parseColor } from '../../../../engine/values/color.ts';
import { fmt } from '../../../../engine/values/number-format.ts';
import { keyboardInset } from '../detents.ts';
import { negated, sliderRange, sliderText, steppedFrom } from '../token-edit.ts';
import { CATALOGUE, type Generic } from '../platform/font-catalogue.ts';
import type { MyFont } from '../platform/fonts.ts';
import { WEIGHT_NAMES, offeredWeights } from '../style-edit.ts';
import { Repeat } from '../repeat.ts';
import { useStore } from './store.ts';

const GHOST_CLICK_MS = 350; // the tap that opened a sheet must not close it through the dim

export function Sheets({ editor, workspace }: { editor: Editor; workspace: Workspace }) {
  const sheet = useStore(editor.sheet);
  if (!sheet) return null;
  const key =
    sheet.kind === 'insert' ? 'insert'
    : sheet.kind === 'source' ? `source:${sheet.node}${sheet.whole ? ':whole' : ''}`
    : sheet.kind === 'style' ? `style:${sheet.prop}:${sheet.ids.join(',')}`
    : sheet.kind === 'lines' ? `lines:${sheet.id}`
    : sheet.kind === 'font' ? `font:${sheet.ids.join(',')}`
    : sheet.kind === 'weight' ? `weight:${sheet.family}`
    : `${sheet.kind}:${sheet.ref.node}:${sheet.ref.index}`;
  const close = () => (sheet.kind === 'source' ? editor.closeSource() : editor.closeSheet());
  // A path's number is named for what it is ("point 2 x", "control 1 y": P1-M3), else its property.
  const title =
    sheet.kind === 'source' ? 'Edit source'
    : sheet.kind === 'insert' ? 'Insert'
    : sheet.kind === 'style' ? sheet.prop
    : sheet.kind === 'lines' ? 'Text'
    : sheet.kind === 'font' ? 'Font'
    : sheet.kind === 'weight' ? `${sheet.family} weight`
    : sheet.kind === 'number' ? (sheet.token.label ?? sheet.token.prop)
    : sheet.token.prop;
  const mono = sheet.kind !== 'lines' && sheet.kind !== 'font' && sheet.kind !== 'weight' && sheet.kind !== 'insert';
  return (
    <Modal key={key} title={title} onClose={close} done={sheet.kind !== 'source'} mono={mono}>
      <Body editor={editor} workspace={workspace} sheet={sheet} close={close} />
    </Modal>
  );
}

function Body({ editor, workspace, sheet, close }: { editor: Editor; workspace: Workspace; sheet: Sheet; close: () => void }) {
  switch (sheet.kind) {
    case 'insert':
      return <InsertBody editor={editor} workspace={workspace} />;
    case 'number':
      return <NumberBody editor={editor} sheet={sheet} close={close} />;
    case 'color':
      return <ColorBody editor={editor} slot={sheet.token} text={sheet.token.text} />;
    case 'style': {
      const locals = sheet.ids.map((id) => editor.doc?.nodes.get(id)).flatMap((n) => (n?.kind === 'element' ? [n.local] : []));
      return <ColorBody editor={editor} slot={styleSlot(sheet.prop, locals)} text={sheet.text} width={sheet.prop === 'stroke'} />;
    }
    case 'text':
      return <TextBody editor={editor} sheet={sheet} close={close} />;
    case 'source':
      return <SourceBody editor={editor} sheet={sheet} close={close} />;
    case 'lines':
      return <LinesBody editor={editor} sheet={sheet} />;
    case 'font':
      return <FontBody editor={editor} />;
    case 'weight':
      return <WeightBody editor={editor} sheet={sheet} />;
  }
}

/** A sheet over a dimmed canvas (the token sheets here, and the Files, report and Export sheets in FileSheets.tsx). */
export function Modal({ title, onClose, done, mono = true, children }: { title: string; onClose: () => void; done: boolean; mono?: boolean; children: ReactNode }) {
  const opened = useRef(performance.now());
  const pressed = useRef(false); // a press began inside the sheet since it opened
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    const vv = window.visualViewport;
    const fix = () => vv && setInset(keyboardInset(window.innerHeight, vv.height, vv.offsetTop));
    vv?.addEventListener('resize', fix);
    vv?.addEventListener('scroll', fix);
    fix();
    return () => {
      window.removeEventListener('keydown', key);
      vv?.removeEventListener('resize', fix);
      vv?.removeEventListener('scroll', fix);
    };
  }, [onClose]);
  return (
    <>
      {/* A press on the dim never takes the sheet's focus (a phone's late mouse events land here after
          the tap that opened it, and the field would lose its keyboard); a tap still closes it by its click. */}
      <div className="draw-scrim" aria-hidden="true" onMouseDown={(e) => e.preventDefault()} onClick={() => performance.now() - opened.current > GHOST_CLICK_MS && onClose()} />
      {/* Above the keyboard, and no taller than the room left there, so Done never goes off the top. */}
      {/* The click that ends the tap which opened the sheet lands on whatever is under the finger
          now: a swatch, ±. A click in the first moments whose press didn't start in the sheet is
          that one, and does nothing (a key's click, detail 0, has no press and always counts); its
          mousedown, by the same rule, takes no focus. */}
      <section
        className="draw-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={inset ? { bottom: inset, maxHeight: `calc(85svh - ${inset}px)` } : undefined}
        onPointerDownCapture={() => (pressed.current = true)}
        onMouseDownCapture={(e) => {
          if (!pressed.current && performance.now() - opened.current <= GHOST_CLICK_MS) e.preventDefault();
        }}
        onClickCapture={(e) => {
          if (pressed.current || e.detail === 0 || performance.now() - opened.current > GHOST_CLICK_MS) return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="draw-modal-head">
          <h2 className={`draw-modal-title${mono ? ' ds-mono' : ''}`}>{title}</h2>
          {done && (
            <button type="button" className="ds-btn ds-btn--primary draw-modal-done" onClick={onClose}>
              Done
            </button>
          )}
        </div>
        {children}
      </section>
    </>
  );
}

function Problem({ message }: { message: string | null }) {
  return message ? (
    <p className="draw-problem" role="alert">
      {message}
    </p>
  ) : null;
}

type Of<K extends Sheet['kind']> = Extract<Sheet, { kind: K }>;

function NumberBody({ editor, sheet, close }: { editor: Editor; sheet: Of<'number'>; close: () => void }) {
  const [text, setText] = useState(sheet.token.text);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(text); // what a held − or + steps from, between renders
  const [repeat] = useState(() => new Repeat());
  useEffect(() => () => repeat.stop(), [repeat]);
  const put = (t: string) => {
    latest.current = t;
    setText(t);
    const r = editor.sheetInput(t);
    setProblem('error' in r ? r.error : null);
  };
  const t = sheet.token;
  const unit = t.unit;
  const range = sliderRange(t, editor.extent());
  const value = Number(text);
  // − and +: a press steps at once and, held, repeats; a key (Enter or Space: a click with no
  // pointer, detail 0) steps once.
  const stepper = (d: number) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); // keep the field's keyboard up, and no text selection on a long press
      repeat.start(() => put(steppedFrom(t, latest.current, d)));
    },
    onPointerUp: () => repeat.stop(),
    onPointerLeave: () => repeat.stop(),
    onPointerCancel: () => repeat.stop(),
    onClick: (e: { detail: number }) => e.detail === 0 && put(steppedFrom(t, latest.current, d)),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  });
  return (
    <>
      <div className="draw-stepper">
        <button type="button" className="draw-key" aria-label="Decrease" {...stepper(-1)}>
          −
        </button>
        <input
          className="draw-field ds-mono"
          aria-label={sheet.token.prop}
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={text}
          onChange={(e) => put(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && close()}
        />
        {unit && <span className="draw-unit ds-mono">{unit}</span>}
        <button type="button" className="draw-key" aria-label="Increase" {...stepper(1)}>
          +
        </button>
        <button type="button" className="draw-key" aria-label="Change the sign" onClick={() => put(negated(text))}>
          ±
        </button>
      </div>
      <input
        type="range"
        className="draw-range"
        aria-label={`${t.prop} slider`}
        min={range.min}
        max={range.max}
        step={range.step}
        value={Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : t.value}
        onChange={(e) => put(sliderText(t, Number(e.target.value)))}
      />
      <Problem message={problem} />
    </>
  );
}

function ColorBody({ editor, slot, text, width = false }: { editor: Editor; slot: ColorSlot; text: string; width?: boolean }) {
  const [current, setCurrent] = useState(text); // the value written now (its choice is ringed)
  const [custom, setCustom] = useState(text); // the field: the text that will be written
  const [picker, setPicker] = useState(() => pickerStart(text));
  const latest = useRef(picker); // what the next move starts from, between renders
  const [before] = useState(() => (parseColor(text)?.kind === 'color' ? pickerCss(pickerStart(text)) : null));
  const [problem, setProblem] = useState<string | null>(null);
  const put = (t: string, next?: Picker) => {
    const r = editor.sheetInput(t);
    if ('error' in r) return setProblem(r.error);
    setProblem(null);
    setCurrent(r.text);
    setCustom(r.text);
    latest.current = next ?? pickText(latest.current, r.text);
    setPicker(latest.current);
  };
  const move = (p: Picker) => put(pickerText(p), p);
  const { swatches, chips } = colorChoices(slot, current);
  const now = parseColor(current)?.kind === 'color' ? pickerCss(picker) : null;
  return (
    <div className="draw-color">
      <div className="draw-swatches" role="group" aria-label="Palette">
        {swatches.map((c) => (
          <button key={c.value} type="button" className="draw-swatch" style={{ background: c.value }} aria-label={c.value} aria-pressed={c.current} onClick={() => put(c.value)} />
        ))}
      </div>
      {chips.length > 0 && (
        <div className="draw-chips">
          {chips.map((k) => (
            <button key={k.value} type="button" className="draw-chip ds-mono" aria-pressed={k.current} onClick={() => put(k.value)}>
              {k.value}
            </button>
          ))}
        </div>
      )}
      <HsvSquare picker={picker} onPick={(sat, val) => move(pickSV(latest.current, sat, val))} />
      <input
        type="range"
        className="draw-range draw-hue"
        aria-label="Hue"
        min={0}
        max={360}
        step={1}
        value={Math.round(picker.h)}
        onChange={(e) => move(pickHue(latest.current, Number(e.target.value)))}
      />
      <input
        type="range"
        className="draw-range draw-alpha"
        aria-label="Alpha"
        min={0}
        max={100}
        step={1}
        value={Math.round(picker.a * 100)}
        style={{ '--draw-alpha-to': pickerCss(picker, false) } as CSSProperties}
        onChange={(e) => move(pickAlpha(latest.current, Number(e.target.value) / 100))}
      />
      <div className="draw-preview" aria-hidden="true">
        <span className={before ? undefined : 'draw-preview-none'} style={before ? { backgroundColor: before } : undefined} />
        <span className={now ? undefined : 'draw-preview-none'} style={now ? { backgroundColor: now } : undefined} />
      </div>
      <div className="draw-custom">
        <input
          className="draw-field ds-mono"
          aria-label="Colour"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && put(custom)}
        />
        <button type="button" className="draw-key draw-use" onClick={() => put(custom)}>
          Use
        </button>
      </div>
      {width && <WidthSlider editor={editor} />}
      <Problem message={problem} />
    </div>
  );
}

/**
 * The HSV square: saturation left to right, brightness bottom to top. A press sets it and a drag
 * follows (the pointer captured, so the drag never reaches the canvas); the arrows move it 0.01,
 * with Shift 0.1.
 */
function HsvSquare({ picker, onPick }: { picker: Picker; onPick: (s: number, v: number) => void }) {
  const at = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onPick((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
  };
  const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  return (
    <div
      className="draw-hsv"
      role="slider"
      tabIndex={0}
      aria-label="Saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(picker.s * 100)}
      aria-valuetext={`saturation ${Math.round(picker.s * 100)}%, brightness ${Math.round(picker.v * 100)}%`}
      style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueCss(picker.h)})` }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        at(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && at(e)}
      onPointerUp={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && e.currentTarget.releasePointerCapture(e.pointerId)}
      onKeyDown={(e) => {
        const d = ARROWS[e.key];
        if (!d) return;
        e.preventDefault();
        const n = e.shiftKey ? 0.1 : 0.01;
        onPick(picker.s + d[0] * n, picker.v + d[1] * n);
      }}
    >
      <span className="draw-hsv-thumb" style={{ left: `${picker.s * 100}%`, top: `${(1 - picker.v) * 100}%` }} />
    </div>
  );
}

/** The stroke sheet's stroke-width: 0 to 20k by the snap step, written in the same visit as the stroke. */
function WidthSlider({ editor }: { editor: Editor }) {
  useStore(editor.version);
  const row = editor.styleRow('stroke-width');
  const range = widthRange(editor.styleCtx);
  const v = parseFloat(row?.value ?? '');
  const value = Number.isFinite(v) ? Math.min(range.max, Math.max(0, v)) : 1;
  return (
    <div className="draw-width">
      <span className="draw-width-name">stroke-width</span>
      <input
        type="range"
        className="draw-range"
        aria-label="stroke-width"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        disabled={!!row?.disabled}
        onChange={(e) => editor.sheetInput(fmt(Number(e.target.value), 10), 'stroke-width')}
      />
      <span className="draw-width-value ds-mono">{row?.mixed ? 'Mixed' : fmt(value, 2)}</span>
    </div>
  );
}

function TextBody({ editor, sheet, close }: { editor: Editor; sheet: Of<'text'>; close: () => void }) {
  const [text, setText] = useState(sheet.token.text);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <>
      <input
        className="draw-field draw-wide"
        aria-label="Text"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const r = editor.sheetInput(e.target.value);
          setProblem('error' in r ? r.error : null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && close()}
      />
      <Problem message={problem} />
    </>
  );
}

function SourceBody({ editor, sheet, close }: { editor: Editor; sheet: Of<'source'>; close: () => void }) {
  const [text, setText] = useState(sheet.text);
  const [problem, setProblem] = useState<SourceError | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const apply = () => {
    const e = sheet.whole ? editor.applyDrawingSource(text) : editor.applySource(sheet.node, text);
    setProblem(e);
    if (e && area.current) {
      area.current.focus();
      area.current.setSelectionRange(e.at, Math.min(text.length, e.at + 1));
    }
  };
  return (
    <>
      {sheet.whole && <pre className="draw-source-tag draw-source-start ds-mono">{sheet.whole.start}</pre>}
      <textarea
        ref={area}
        className="draw-source ds-mono"
        aria-label={sheet.whole ? 'The drawing’s content' : 'Element source'}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {sheet.whole && <pre className="draw-source-tag draw-source-end ds-mono">{sheet.whole.end}</pre>}
      <Problem message={problem && `Line ${problem.line}, column ${problem.column}: ${problem.message}`} />
      <div className="draw-actions">
        <button type="button" className="ds-btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="ds-btn ds-btn--primary" onClick={apply}>
          Apply
        </button>
      </div>
    </>
  );
}

/**
 * The Insert sheet (P1-M5): a field for SVG (a paste, read through pasted(), or typing), Insert, and
 * Choose a file… (read as the importer reads a file). The workspace inserts it as one group and reads
 * the import report again; a refusal is the notice, and the sheet stays.
 */
function InsertBody({ editor, workspace }: { editor: Editor; workspace: Workspace }) {
  const [text, setText] = useState('');
  const file = useRef<HTMLInputElement>(null);
  // While the sheet is open, a paste made anywhere but its field fills the field (App leaves it here).
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || (e.target as Element | null)?.closest?.('.draw-insert-field')) return;
      const p = pasted(e);
      if (!p) return;
      e.preventDefault();
      setText(p.text);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, []);
  const pick = async (el: HTMLInputElement) => {
    const f = el.files?.[0];
    el.value = ''; // the same file can be picked again
    if (!f) return;
    try {
      workspace.insert((await decodeSvg(await readFile(f))).text);
    } catch (e) {
      editor.notice.set(`That file can’t be inserted: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <>
      <textarea
        className="draw-field draw-insert-field ds-mono"
        aria-label="SVG to insert"
        placeholder="Paste SVG markup here"
        rows={6}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const p = pasted(e.nativeEvent);
          if (!p?.svg) return; // plain text pastes where the caret is
          e.preventDefault();
          setText(p.text);
        }}
      />
      {/* iOS offers only the types listed here: .svg must be named, not just image/svg+xml. */}
      <input ref={file} type="file" accept=".svg,.svgz,image/svg+xml" hidden onChange={(e) => void pick(e.currentTarget)} />
      <div className="draw-actions">
        <button type="button" className="ds-btn draw-insert-file" onClick={() => file.current?.click()}>
          Choose a file…
        </button>
        <button type="button" className="ds-btn ds-btn--primary draw-insert-go" disabled={!text.trim()} onClick={() => workspace.insert(text)}>
          Insert
        </button>
      </div>
    </>
  );
}

/** The Text sheet's lines (P1-M4): one line per line of the text; Return adds one. */
function LinesBody({ editor, sheet }: { editor: Editor; sheet: Of<'lines'> }) {
  const [text, setText] = useState(sheet.text);
  const [problem, setProblem] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const a = area.current;
    if (!a) return;
    try {
      a.focus({ preventScroll: true });
      if (sheet.select) a.select(); // the Text tool's "Hello", ready to type over (SVG Lab's Sheet.text)
      else a.setSelectionRange(a.value.length, a.value.length);
    } catch {
      // a field that can't take the focus: typing starts with a tap
    }
  }, [sheet.select]);
  return (
    <>
      <textarea
        ref={area}
        className="draw-field draw-lines"
        aria-label="Text"
        rows={Math.max(2, text.split('\n').length)}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setProblem(editor.linesInput(e.target.value));
        }}
      />
      <Problem message={problem} />
    </>
  );
}

/** A row of the Font sheet: a family drawn in its own face (its fallback until the face arrives). */
interface FontRow {
  key: string;
  family: string; // what a pick writes (a generic alone)
  label: string;
  css: string; // the row's own font-family
  mine?: MyFont;
}
interface FontGroup {
  title: string;
  rows: FontRow[];
}
const GENERIC_ROWS: [string, string][] = [['sans-serif', 'Sans-serif'], ['serif', 'Serif'], ['monospace', 'Monospace']];
const quoted = (family: string) => `"${family.replace(/["\\]/g, '\\$&')}"`;

/** The Font sheet's groups (P1-M4): Draw's fonts (font-catalogue.ts alone), yours, the generics. P2's library fonts join this list. */
export function fontGroups(mine: readonly MyFont[]): FontGroup[] {
  const generic = (g: Generic) => g;
  return [
    { title: 'Draw’s fonts', rows: CATALOGUE.map((f) => ({ key: `draw:${f.family}`, family: f.family, label: f.family, css: `${quoted(f.family)}, ${generic(f.generic)}` })) },
    { title: 'Your fonts', rows: mine.map((m) => ({ key: `mine:${m.id}`, family: m.family, label: `${m.family}${m.weight !== 400 || m.style !== 'normal' ? ` ${m.weight}${m.style === 'italic' ? ' italic' : ''}` : ''}`, css: `${quoted(m.family)}, sans-serif`, mine: m })) },
    { title: 'Generic', rows: GENERIC_ROWS.map(([g, label]) => ({ key: `generic:${g}`, family: g, label, css: g })) },
  ];
}

function FontBody({ editor }: { editor: Editor }) {
  useStore(editor.version);
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null); // a font of yours whose Remove was tapped once
  const now = editor.textFamily();
  const current = now && !now.mixed ? now.family.trim().toLowerCase() : null;
  const pick = (el: HTMLInputElement) => {
    const file = el.files?.[0];
    el.value = ''; // the same file can be picked again
    if (file) void editor.addFont(file, file.name).then(setProblem);
  };
  return (
    <div className="draw-fonts">
      {fontGroups(editor.myFonts()).map((g) => (
        <section key={g.title} className="draw-font-group" aria-label={g.title}>
          <h3 className="draw-subhead">{g.title}</h3>
          {!g.rows.length && <p className="ds-small ds-muted draw-hint-text">None yet: Add a font… keeps one on this device.</p>}
          {g.rows.map((r) => (
            <div key={r.key} className="draw-font-line">
              <button type="button" className="ds-btn draw-font-row" style={{ fontFamily: r.css }} aria-pressed={current === r.family.toLowerCase()} onClick={() => editor.setFont(r.family)}>
                {r.label}
              </button>
              {r.mine && (
                <button
                  type="button"
                  className="ds-btn draw-font-remove"
                  aria-label={confirm === r.mine.id ? `Remove ${r.mine.family} from this device?` : `Remove ${r.label}`}
                  onClick={() => {
                    if (confirm !== r.mine!.id) return setConfirm(r.mine!.id);
                    setConfirm(null);
                    void editor.removeFont(r.mine!.id);
                  }}
                >
                  {confirm === r.mine.id ? `Remove ${r.mine.family} from this device?` : 'Remove'}
                </button>
              )}
            </div>
          ))}
        </section>
      ))}
      <button type="button" className="ds-btn draw-font-add" onClick={() => input.current?.click()}>
        Add a font…
      </button>
      {/* iOS offers only the types listed here: the extensions must be named, not just the types. */}
      <input ref={input} type="file" accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf,application/font-woff,application/x-font-ttf,application/x-font-otf,application/vnd.ms-opentype" hidden onChange={(e) => pick(e.currentTarget)} />
      <Problem message={problem} />
    </div>
  );
}

function WeightBody({ editor, sheet }: { editor: Editor; sheet: Of<'weight'> }) {
  useStore(editor.version);
  const row = editor.styleRow('font-weight', sheet.ids);
  const styleRow = editor.styleRow('font-style', sheet.ids);
  const italic = !!styleRow && !styleRow.mixed && /^(italic|oblique)/i.test(styleRow.value);
  const faces = editor.familyFaces(sheet.family);
  const list = offeredWeights(faces, italic ? 'italic' : 'normal');
  const now = row && !row.mixed ? (row.value === 'normal' ? 400 : row.value === 'bold' ? 700 : Number(row.value)) : null;
  return (
    <div className="draw-fonts">
      {list.map((w) => (
        <button
          key={w}
          type="button"
          className="ds-btn draw-font-row"
          style={{ fontFamily: `${quoted(sheet.family)}, sans-serif`, fontWeight: w, fontStyle: italic && faces?.italics.includes(w) ? 'italic' : 'normal' }}
          aria-pressed={now === w}
          onClick={() => {
            editor.setStyle('font-weight', String(w), sheet.ids);
            editor.closeSheet();
          }}
        >
          {WEIGHT_NAMES[w] ?? 'Weight'} {w}
        </button>
      ))}
    </div>
  );
}

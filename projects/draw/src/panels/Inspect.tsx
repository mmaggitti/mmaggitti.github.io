// The Inspect tab: the selected elements' values. P1-M2 adds its sections above P0's attribute
// list ("All attributes", the element's attributes as the file has them, for one element):
// - Style (S2), for one or more selected elements: Fill (no Fill for lines), Stroke, Opacity, Line,
//   Paint order, Rendering and Color. Each property's row shows the first element's value (Mixed
//   when the others differ) and where it comes from ("from <g#badge>", "default", "set by a <style>
//   rule", whose control is disabled with the P2 notice). A swatch opens the Colour sheet over the
//   selection; a segment, preset or switch is one entry; a slider one entry per press; a field one
//   entry while it has focus.
// - Generator (S1), for one generated shape (engine/generators/): its kind, a field per input with −
//   and + (one entry each), and Detach.
// A field is one history entry while it has focus: each keystroke that reads as a value is written
// live, and Done, Enter, Escape or a blur keeps it. While it has focus it shows what is typed; else
// it follows the file (an undo, a handle drag, − or +).
// Panels only read the editor's stores and call its methods; nothing here writes the document.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { decodeAttr } from '../../../../engine/xml/entities.ts';
import type { ElementNode } from '../../../../engine/model/doc.ts';
import { parseColor } from '../../../../engine/values/color.ts';
import { fmt } from '../../../../engine/values/number-format.ts';
import { STYLE_PROPS } from '../../../../engine/style/props.ts';
import type { Editor, Field, StyleRow } from '../editor.ts';
import { INPUT_UI } from '../interact/shapes-tool.ts';
import { dashPresets, paintKinds, widthRange, type PaintKind } from '../style-edit.ts';
import { elementLabel } from './label.ts';
import { useStore } from './store.ts';

export function Inspect({ editor }: { editor: Editor }) {
  const selection = useStore(editor.selection);
  useStore(editor.version);
  const doc = editor.doc;
  const ids = doc ? [...selection].filter((id) => doc.nodes.get(id)?.kind === 'element') : [];
  if (!doc || !ids.length) return <p className="draw-empty ds-muted">Select something to see its attributes.</p>;
  const one = ids.length === 1 ? (doc.nodes.get(ids[0]) as ElementNode) : null;
  const locals = ids.map((id) => (doc.nodes.get(id) as ElementNode).local);
  const gen = editor.generated();
  return (
    <div className="draw-inspect">
      {!one && <p className="draw-subhead">{ids.length} selected</p>}
      <StyleSections editor={editor} locals={locals} />
      {gen && (
        <section className="draw-inspect-section" aria-label="Generator">
          <p className="draw-subhead">{gen.label}</p>
          {gen.inputs.map((i) => (
            <InputRow key={`${gen.id}:${i.name}`} editor={editor} name={i.name} text={i.text} />
          ))}
          <button type="button" className="ds-btn draw-inspect-btn" onClick={() => editor.detach()}>
            Detach
          </button>
        </section>
      )}
      {one && (
        <>
          <p className="draw-subhead">All attributes</p>
          <dl className="ds-list draw-attrs">
            <div className="ds-row">
              <dt>element</dt>
              <dd className="ds-mono">{elementLabel(doc, one.id)}</dd>
            </div>
            {one.attrs.map((a, i) => (
              <div className="ds-row" key={`${i}:${a.qname}`}>
                <dt className="ds-mono">{a.qname}</dt>
                <dd className="ds-mono">{decodeAttr(a.raw, doc.entities)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}

// ── style ────────────────────────────────────────────────────────────────────────────────────

const CAPS: [string, string][] = [['butt', 'Butt'], ['round', 'Round'], ['square', 'Square']];
const JOINS: [string, string][] = [['miter', 'Miter'], ['round', 'Round'], ['bevel', 'Bevel']];
const ORDERS: [string, string][] = [['normal', 'Fill first'], ['stroke', 'Stroke first']];
const RENDERING: [string, string][] = [['auto', 'auto'], ['crispEdges', 'crispEdges'], ['geometricPrecision', 'geometricPrecision'], ['optimizeSpeed', 'optimizeSpeed']];
const UNIT = { min: 0, max: 1, step: 0.01 };

function StyleSections({ editor, locals }: { editor: Editor; locals: readonly string[] }) {
  const row = (prop: string) => editor.styleRow(prop)!;
  const ctx = editor.styleCtx;
  const join = row('stroke-linejoin');
  const jv = join.value.toLowerCase();
  const joins = !join.mixed && (jv === 'miter-clip' || jv === 'arcs') ? [...JOINS, [jv, jv] as [string, string]] : JOINS;
  const miter = join.mixed || jv === 'miter' || jv === 'miter-clip';
  const fillKinds = paintKinds('fill', locals);
  return (
    <>
      {fillKinds && (
        <Section title="Fill">
          <PaintRow editor={editor} prop="fill" label="Paint" row={row('fill')} kinds={fillKinds} />
        </Section>
      )}
      <Section title="Stroke">
        <PaintRow editor={editor} prop="stroke" label="Paint" row={row('stroke')} kinds={paintKinds('stroke', locals)!} />
        <NumberRow editor={editor} prop="stroke-width" label="Width" row={row('stroke-width')} slider={widthRange(ctx)} />
      </Section>
      <Section title="Opacity">
        <SliderRow editor={editor} prop="opacity" label="Opacity" row={row('opacity')} range={UNIT} />
        <SliderRow editor={editor} prop="fill-opacity" label="Fill" row={row('fill-opacity')} range={UNIT} />
        <SliderRow editor={editor} prop="stroke-opacity" label="Stroke" row={row('stroke-opacity')} range={UNIT} />
      </Section>
      <Section title="Line">
        <SegRow editor={editor} prop="stroke-linecap" label="Cap" row={row('stroke-linecap')} options={CAPS} />
        <SegRow editor={editor} prop="stroke-linejoin" label="Join" row={join} options={joins} />
        {miter && <NumberRow editor={editor} prop="stroke-miterlimit" label="Miter limit" row={row('stroke-miterlimit')} />}
        <SegRow editor={editor} prop="stroke-dasharray" label="Dash" row={row('stroke-dasharray')} options={dashPresets(ctx.k).map((d): [string, string] => [d, d === 'none' ? 'None' : d])} />
        <NumberRow editor={editor} prop="stroke-dashoffset" label="Dash offset" row={row('stroke-dashoffset')} />
      </Section>
      <Section title="Paint order">
        <SegRow editor={editor} prop="paint-order" label="Order" row={row('paint-order')} options={ORDERS} />
      </Section>
      <Section title="Rendering">
        <SwitchRow editor={editor} prop="vector-effect" label="Non-scaling stroke" row={row('vector-effect')} on="non-scaling-stroke" off="none" />
        <SegRow editor={editor} prop="shape-rendering" label="Shapes" row={row('shape-rendering')} options={RENDERING} two />
      </Section>
      <Section title="Color">
        <PaintRow editor={editor} prop="color" label="currentColor" row={row('color')} />
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="draw-inspect-section" aria-label={title}>
      <p className="draw-subhead">{title}</p>
      {children}
    </section>
  );
}

/** A property's row: its name, its control, what Inspect says about the value, and the P2 notice when a rule decides it. */
function Row({ label, row, children }: { label: string; row: StyleRow; children: ReactNode }) {
  const note = row.mixed ? 'Mixed' : row.note;
  return (
    <div className="draw-inspect-row" data-prop-row="">
      <span className="draw-inspect-name">{label}</span>
      {children}
      {note && !row.disabled && <p className="draw-inspect-note">{note}</p>}
      {row.disabled && (
        <p className="draw-inspect-note" role="status">
          {row.disabled}
        </p>
      )}
    </div>
  );
}

/**
 * Fill, stroke and color: a swatch that opens the Colour sheet over the selection. Fill and stroke
 * add their paint kinds (paintKinds: a line's stroke has no None): None writes none; Colour opens
 * the sheet.
 */
function PaintRow({ editor, prop, label, row, kinds = [] }: { editor: Editor; prop: string; label: string; row: StyleRow; kinds?: readonly PaintKind[] }) {
  const v = row.value;
  const colour = !row.mixed && parseColor(v)?.kind === 'color';
  const text = row.mixed ? 'Mixed' : v || '?';
  return (
    <Row label={label} row={row}>
      <button type="button" className="draw-inspect-swatch" aria-label={`${prop}: ${text}`} disabled={!!row.disabled} onClick={() => editor.openStyleSheet(prop)}>
        <span className="draw-inspect-chip" style={colour ? { background: v } : undefined} />
        <span className="draw-inspect-text ds-mono">{text}</span>
      </button>
      {kinds.length > 0 && (
        <div className="ds-seg draw-inspect-seg" role="group" aria-label={`${prop} kind`}>
          {kinds.includes('none') && (
            <button type="button" aria-pressed={!row.mixed && v.toLowerCase() === 'none'} disabled={!!row.disabled} onClick={() => editor.setStyle(prop, 'none')}>
              None
            </button>
          )}
          <button type="button" aria-pressed={!row.mixed && !!parseColor(v)} disabled={!!row.disabled} onClick={() => editor.openStyleSheet(prop)}>
            Colour
          </button>
        </div>
      )}
    </Row>
  );
}

/** A keyword property's segments: a tap is one entry. A value outside them is shown as written (no segment pressed) and kept. */
function SegRow({ editor, prop, label, row, options, two = false }: { editor: Editor; prop: string; label: string; row: StyleRow; options: readonly [string, string][]; two?: boolean }) {
  const v = row.mixed ? null : row.value.toLowerCase().replace(/[\s,]+/g, ' ');
  const known = options.some(([o]) => o.toLowerCase() === v);
  return (
    <Row label={label} row={row}>
      {!known && v !== null && <span className="draw-inspect-value ds-mono">{row.value}</span>}
      <div className={`ds-seg draw-inspect-seg${two ? ' draw-inspect-seg--two' : ''}`} role="group" aria-label={prop}>
        {options.map(([value, text]) => (
          <button key={value} type="button" aria-pressed={v === value.toLowerCase()} disabled={!!row.disabled} onClick={() => editor.setStyle(prop, value)}>
            {text}
          </button>
        ))}
      </div>
    </Row>
  );
}

/** A switch between two values (Non-scaling stroke): a tap is one entry. */
function SwitchRow({ editor, prop, label, row, on, off }: { editor: Editor; prop: string; label: string; row: StyleRow; on: string; off: string }) {
  const checked = !row.mixed && row.value.toLowerCase() === on;
  return (
    <Row label={label} row={row}>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className="draw-inspect-switch" disabled={!!row.disabled} onClick={() => editor.setStyle(prop, checked ? off : on)}>
        {checked ? 'On' : 'Off'}
      </button>
    </Row>
  );
}

/** A slider (the opacities): one entry per press; a key step (no press) is one entry of its own. */
function SliderRow({ editor, prop, label, row, range }: { editor: Editor; prop: string; label: string; row: StyleRow; range: { min: number; max: number; step: number } }) {
  return (
    <Row label={label} row={row}>
      <StyleSlider editor={editor} prop={prop} row={row} range={range} />
      <span className="draw-inspect-value ds-mono">{row.mixed ? 'Mixed' : row.value}</span>
    </Row>
  );
}

// A press holds the slider's one entry until the pointer lifts anywhere: a mouse let go off the
// slider sends the slider nothing, so the release is heard on the window, and the slider going
// away (the selection changed) ends it too.
function StyleSlider({ editor, prop, row, range }: { editor: Editor; prop: string; row: StyleRow; range: { min: number; max: number; step: number } }) {
  const held = useRef<(() => void) | null>(null); // while pressed: takes the release listeners off
  const read = parseFloat(row.value);
  const value = Number.isFinite(read) ? read : Number(STYLE_PROPS[prop]?.initial ?? 0);
  const end = useRef(() => {});
  end.current = () => {
    const off = held.current;
    if (!off) return;
    held.current = null;
    off();
    editor.styleDragEnd();
  };
  useEffect(() => () => end.current(), []);
  return (
    <input
      type="range"
      className="draw-range draw-inspect-range"
      aria-label={prop}
      min={range.min}
      max={range.max}
      step={range.step}
      value={Math.min(range.max, Math.max(range.min, value))}
      disabled={!!row.disabled}
      onPointerDown={() => {
        if (held.current || !editor.styleDrag(prop)) return;
        const up = () => end.current();
        window.addEventListener('pointerup', up, true);
        window.addEventListener('pointercancel', up, true);
        held.current = () => {
          window.removeEventListener('pointerup', up, true);
          window.removeEventListener('pointercancel', up, true);
        };
      }}
      onChange={(e) => {
        const t = fmt(Number(e.target.value), 10);
        if (held.current) editor.styleInput(t);
        else editor.setStyle(prop, t);
      }}
      onBlur={() => end.current()}
    />
  );
}

/** A number property's field (and, for the stroke's width, a slider): the field is one entry while it has focus. */
function NumberRow({ editor, prop, label, row, slider }: { editor: Editor; prop: string; label: string; row: StyleRow; slider?: { min: number; max: number; step: number } }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Row label={label} row={row}>
      <FocusField editor={editor} field={{ kind: 'style', prop }} label={prop} text={row.mixed ? '' : row.value} placeholder={row.mixed ? 'Mixed' : undefined} disabled={!!row.disabled} onError={setError} />
      {slider && <StyleSlider editor={editor} prop={prop} row={row} range={slider} />}
      <Problem error={error} />
    </Row>
  );
}

function Problem({ error }: { error: string | null }) {
  return error ? (
    <p className="draw-inspect-error ds-small" role="status">
      {error}
    </p>
  ) : null;
}

/**
 * A field that is one history entry while it has focus (a style number, a generator input): what
 * is typed is written live when it reads as a value, else it says why. While it has focus it shows
 * what is typed; else it follows the file.
 */
function FocusField({ editor, field, label, text, placeholder, disabled = false, onError }: { editor: Editor; field: Field; label: string; text: string; placeholder?: string; disabled?: boolean; onError: (error: string | null) => void }) {
  const focused = useRef(false);
  const [value, setValue] = useState(text);
  useEffect(() => {
    if (!focused.current) setValue(text);
  }, [text]);
  // A field still focused when it goes (the selection changed) keeps what was typed, as a blur would.
  useEffect(
    () => () => {
      if (focused.current) editor.fieldEnd();
    },
    [editor],
  );
  return (
    <input
      className="draw-field ds-mono draw-inspect-field"
      inputMode="decimal"
      enterKeyHint="done"
      autoComplete="off"
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      value={value}
      onFocus={() => {
        focused.current = true;
        editor.fieldStart(field);
      }}
      onBlur={() => {
        focused.current = false;
        editor.fieldEnd();
        onError(null);
        setValue(text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
      }}
      onChange={(e) => {
        setValue(e.target.value);
        onError(editor.fieldInput(e.target.value));
      }}
    />
  );
}

// ── generator ────────────────────────────────────────────────────────────────────────────────

/** One generator input: − , a field, +. */
function InputRow({ editor, name, text }: { editor: Editor; name: string; text: string }) {
  const ui = INPUT_UI[name];
  const label = ui?.label ?? name;
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="draw-inspect-row">
      <span className="draw-inspect-name">{label}</span>
      <div className="draw-stepper">
        <button type="button" className="draw-key" aria-label={`Decrease ${label}`} onClick={() => editor.stepInput(name, -1)}>
          −
        </button>
        <FocusField editor={editor} field={{ kind: 'input', name }} label={label} text={text} onError={setError} />
        <button type="button" className="draw-key" aria-label={`Increase ${label}`} onClick={() => editor.stepInput(name, 1)}>
          +
        </button>
      </div>
      <Problem error={error} />
    </div>
  );
}

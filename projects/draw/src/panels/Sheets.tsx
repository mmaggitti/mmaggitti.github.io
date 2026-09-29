// The modal sheets: Number, Color and Text for a code token, and Edit source for the selected
// element. Each slides up over a dimmed canvas, closes with Done, a tap on the dim or Escape, and
// sits above the on-screen keyboard (SVG Lab's visualViewport fix). A token sheet's edits apply
// live and commit as one history entry when it closes; what can't be written is refused with a
// message, never written. Edit source applies only on Apply, in one transaction.
//
// The Number sheet is SVG Lab's: − and + step (hold one to repeat: repeat.ts), the field takes a
// typed value, and a slider spans the value's range (token-edit.ts sliderRange).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { Editor, Sheet, SourceError } from '../editor.ts';
import { colorChoices, pickerHex } from '../color-choices.ts';
import { keyboardInset } from '../detents.ts';
import { negated, sliderRange, sliderText, steppedFrom } from '../token-edit.ts';
import { Repeat } from '../repeat.ts';
import { useStore } from './store.ts';

const GHOST_CLICK_MS = 350; // the tap that opened a sheet must not close it through the dim

export function Sheets({ editor }: { editor: Editor }) {
  const sheet = useStore(editor.sheet);
  if (!sheet) return null;
  const key = sheet.kind === 'source' ? `source:${sheet.node}` : `${sheet.kind}:${sheet.ref.node}:${sheet.ref.index}`;
  const close = () => (sheet.kind === 'source' ? editor.closeSource() : editor.closeSheet());
  const title = sheet.kind === 'source' ? 'Edit source' : sheet.token.prop;
  return (
    <Modal key={key} title={title} onClose={close} done={sheet.kind !== 'source'}>
      <Body editor={editor} sheet={sheet} close={close} />
    </Modal>
  );
}

function Body({ editor, sheet, close }: { editor: Editor; sheet: Sheet; close: () => void }) {
  switch (sheet.kind) {
    case 'number':
      return <NumberBody editor={editor} sheet={sheet} close={close} />;
    case 'color':
      return <ColorBody editor={editor} sheet={sheet} />;
    case 'text':
      return <TextBody editor={editor} sheet={sheet} close={close} />;
    case 'source':
      return <SourceBody editor={editor} sheet={sheet} close={close} />;
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
      <div className="draw-scrim" aria-hidden="true" onClick={() => performance.now() - opened.current > GHOST_CLICK_MS && onClose()} />
      {/* Above the keyboard, and no taller than the room left there, so Done never goes off the top. */}
      {/* The click that ends the tap which opened the sheet lands on whatever is under the finger
          now: a swatch, ±. A click in the first moments whose press didn't start in the sheet is
          that one, and does nothing (a key's click, detail 0, has no press and always counts). */}
      <section
        className="draw-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={inset ? { bottom: inset, maxHeight: `calc(85svh - ${inset}px)` } : undefined}
        onPointerDownCapture={() => (pressed.current = true)}
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

function ColorBody({ editor, sheet }: { editor: Editor; sheet: Of<'color'> }) {
  const [current, setCurrent] = useState(sheet.token.text);
  const [custom, setCustom] = useState(sheet.token.text);
  const [problem, setProblem] = useState<string | null>(null);
  const put = (t: string) => {
    const r = editor.sheetInput(t);
    if ('error' in r) return setProblem(r.error);
    setProblem(null);
    setCurrent(r.text);
  };
  const { swatches, chips } = colorChoices(sheet.token, current);
  return (
    <>
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
        <input type="color" className="draw-picker" aria-label="Pick a colour" value={pickerHex(current)} onChange={(e) => (setCustom(e.target.value), put(e.target.value))} />
      </div>
      <Problem message={problem} />
    </>
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
    const e = editor.applySource(sheet.node, text);
    setProblem(e);
    if (e && area.current) {
      area.current.focus();
      area.current.setSelectionRange(e.at, Math.min(text.length, e.at + 1));
    }
  };
  return (
    <>
      <textarea
        ref={area}
        className="draw-source ds-mono"
        aria-label="Element source"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
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

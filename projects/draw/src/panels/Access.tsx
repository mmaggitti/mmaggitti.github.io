// The Access tab (P1-M4 S3): SVG Lab's Accessibility lesson for any drawing (engine/access/).
//
// - First, roughly what a screen reader says (engine/access/speak.ts, computed from the model on each
//   version bump, never from the page: the canvas host stays aria-hidden), and the drawing's language.
// - The drawing: Title (a switch and a field), Description (a switch and a textarea), Language (a
//   field: a language tag, or empty), and Metadata (a switch; while it is off, the Creator and Date it
//   will write, "You" and today; while it is on, each Dublin Core item's text). A role or label the
//   file sets itself is named as the file's: Draw never writes over it.
// - The one selected element: Title (its first child), Label (aria-label), Role, Hidden from screen
//   readers (aria-hidden="true"), its other aria-* attributes (each a field, and Remove), and
//   Focusable (its tabindex, kept: the canvas never focuses it).
// A switch or Remove is one history entry; a field one entry while it has focus (typing a title where
// there is none makes it, in that entry). Panels only read the editor's stores and call its methods.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { META_CREATOR, today, type AccessView, type Editor, type Field } from '../editor.ts';
import { useStore } from './store.ts';

// What each Dublin Core item is called in the tab.
const ITEM_LABELS: Readonly<Record<string, string>> = { 'dc:creator': 'Creator', 'dc:date': 'Date', 'dc:title': 'Title (metadata)', 'dc:description': 'Description (metadata)' };

export function Access({ editor }: { editor: Editor }) {
  useStore(editor.selection);
  useStore(editor.version);
  const a = editor.access();
  if (!a) return <p className="draw-empty ds-muted">Open a drawing to name it.</p>;
  const d = a.drawing;
  return (
    <div className="draw-inspect draw-access">
      <section className="draw-access-said" aria-label="Screen reader preview">
        <p className="draw-access-head">Roughly what a screen reader says:</p>
        <p className="draw-access-sentence" data-access="said">
          {a.said}
        </p>
        {d.lang && (
          <p className="draw-inspect-note" data-access="said-lang">
            Language: {d.lang.value}
          </p>
        )}
      </section>
      <section className="draw-inspect-section" aria-label="Drawing">
        <p className="draw-subhead">Drawing</p>
        <SwitchRow label="Title" name="title" on={d.title !== null} toggle={(on) => editor.setDrawingTitle(on)} />
        <TextRow editor={editor} label="Drawing title" name="title" field={{ kind: 'access', name: 'title' }} text={d.title?.text ?? ''} placeholder="Name the drawing" />
        <FilesOwn view={a} />
        <SwitchRow label="Description" name="desc" on={d.desc !== null} toggle={(on) => editor.setDrawingDesc(on)} />
        <TextRow editor={editor} label="Description" name="desc" field={{ kind: 'access', name: 'desc' }} text={d.desc?.text ?? ''} placeholder="Say what it shows" multiline />
        <TextRow editor={editor} label="Language" name="lang" field={{ kind: 'access', name: 'lang' }} text={d.lang?.value ?? ''} placeholder="en" named />
        <Metadata editor={editor} view={a} />
      </section>
      {a.element ? (
        <Element editor={editor} element={a.element} />
      ) : (
        <p className="draw-inspect-note draw-access-none">{a.selected > 1 ? `${a.selected} selected: select one to give it a title or a label.` : 'Select a shape to give it a title or a label.'}</p>
      )}
    </div>
  );
}

/** The role, labels and hiding the root carries itself: shown, and left as they are. */
function FilesOwn({ view }: { view: AccessView }) {
  const d = view.drawing;
  const own: string[] = [];
  // A reference is Draw's kind when it names exactly the <title>'s (or the <desc>'s) id.
  const names = (v: string | null, id: string | null) => v !== null && v.trim() !== '' && v.trim() !== id;
  if (d.role !== null && d.role.trim().toLowerCase() !== 'img') own.push(`role="${d.role}"`);
  if (names(d.labelledby, view.ids.title)) own.push(`aria-labelledby="${d.labelledby}"`);
  if (names(d.describedby, view.ids.desc)) own.push(`aria-describedby="${d.describedby}"`);
  if (d.label !== null) own.push(`aria-label="${d.label}"`);
  if (d.hidden) own.push('aria-hidden="true"');
  for (const x of d.aria) own.push(`${x.name}="${x.value}"`);
  if (!own.length) return null;
  return (
    <p className="draw-inspect-note" data-access="own">
      The file’s own, left as it is: {own.join(', ')}
    </p>
  );
}

/** Metadata: the switch; while off, what it will write; while on, each item's text. */
function Metadata({ editor, view }: { editor: Editor; view: AccessView }) {
  const [creator, setCreator] = useState(META_CREATOR);
  const [date, setDate] = useState(() => today());
  const on = view.meta.items.length > 0;
  return (
    <>
      <SwitchRow label="Metadata" name="meta" on={on} toggle={(next) => editor.setMetadata(next, { creator, date })} />
      {on
        ? view.meta.items.map((item) => <TextRow key={item.id} editor={editor} label={ITEM_LABELS[item.key] ?? item.key} name={`meta:${item.key}`} field={{ kind: 'access', name: 'meta', id: item.id }} text={item.text} named />)
        : (
          <>
            <Row label="Creator">
              <input className="draw-field draw-access-field" data-access="creator" aria-label="Creator" autoComplete="off" enterKeyHint="done" value={creator} onChange={(e) => setCreator(e.target.value)} />
            </Row>
            <Row label="Date">
              <input className="draw-field draw-access-field ds-mono" data-access="date" aria-label="Date" autoComplete="off" enterKeyHint="done" value={date} onChange={(e) => setDate(e.target.value)} />
            </Row>
            <p className="draw-inspect-note">Written as Dublin Core when Metadata is on.</p>
          </>
        )}
    </>
  );
}

/** The one selected element's section. */
function Element({ editor, element }: { editor: Editor; element: NonNullable<AccessView['element']> }) {
  const id = element.id;
  return (
    <section className="draw-inspect-section" aria-label="Selected element">
      <p className="draw-subhead ds-mono">{element.tag}</p>
      <SwitchRow label="Title" name="el-title" on={element.title !== null} toggle={(on) => editor.setElementTitle(on)} />
      <TextRow key={`t${id}`} editor={editor} label="Element title" name="el-title" field={{ kind: 'access', name: 'el-title', id }} text={element.title?.text ?? ''} placeholder="Shown as a tooltip" />
      <TextRow key={`l${id}`} editor={editor} label="Label" name="label" field={{ kind: 'access', name: 'label', id }} text={element.label ?? ''} placeholder="aria-label" named />
      <TextRow key={`r${id}`} editor={editor} label="Role" name="role" field={{ kind: 'access', name: 'role', id }} text={element.role ?? ''} placeholder="none" named />
      <SwitchRow label="Hidden from screen readers" name="hidden" on={element.hidden} toggle={(on) => editor.setAriaHidden(on)} />
      {element.aria.length > 0 && <p className="draw-subhead">Other ARIA</p>}
      {element.aria.map((x) => (
        <div className="draw-inspect-row" key={`${id}:${x.name}`}>
          <span className="draw-inspect-name ds-mono">{x.name}</span>
          <button type="button" className="ds-btn draw-inspect-btn" data-access={`remove:${x.name}`} aria-label={`Remove ${x.name}`} onClick={() => editor.removeAria(x.name)}>
            Remove
          </button>
          <AccessInput editor={editor} label={x.name} name={`aria:${x.name}`} field={{ kind: 'access', name: 'aria', id, aria: x.name }} text={x.value} />
        </div>
      ))}
      {element.tabindex !== null && (
        <Row label="Focusable">
          <span className="draw-inspect-value ds-mono">tabindex="{element.tabindex}"</span>
          <p className="draw-inspect-note">Kept; the canvas never focuses it.</p>
        </Row>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="draw-inspect-row">
      <span className="draw-inspect-name">{label}</span>
      {children}
    </div>
  );
}

/** A switch: one history entry a tap. */
function SwitchRow({ label, name, on, toggle }: { label: string; name: string; on: boolean; toggle: (on: boolean) => void }) {
  return (
    <Row label={label}>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className="draw-inspect-switch" data-access={`${name}-switch`} onClick={() => toggle(!on)}>
        {on ? 'On' : 'Off'}
      </button>
    </Row>
  );
}

/** A field under its own name (`named`), or under the switch above it. */
function TextRow(props: { editor: Editor; label: string; name: string; field: Field; text: string; placeholder?: string; multiline?: boolean; named?: boolean }) {
  const input = <AccessInput {...props} />;
  return props.named ? <Row label={props.label}>{input}</Row> : <div className="draw-inspect-row">{input}</div>;
}

/**
 * A field that is one history entry while it has focus: what is typed is written live when it reads
 * (a language must be a tag), else it says why. While it has focus it shows what is typed; else it
 * follows the file (an undo, a code edit).
 */
function AccessInput({ editor, label, name, field, text, placeholder, multiline = false }: { editor: Editor; label: string; name: string; field: Field; text: string; placeholder?: string; multiline?: boolean }) {
  const focused = useRef(false);
  const [value, setValue] = useState(text);
  const [error, setError] = useState<string | null>(null);
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
  const shared = {
    className: `draw-field draw-access-field${name === 'lang' || name.startsWith('aria:') || name === 'role' ? ' ds-mono' : ''}`,
    'data-access': name,
    'aria-label': label,
    autoComplete: 'off',
    placeholder,
    value,
    onFocus: () => {
      focused.current = true;
      editor.fieldStart(field);
    },
    onBlur: () => {
      focused.current = false;
      editor.fieldEnd();
      setError(null);
      setValue(text);
    },
    onChange: (e: { target: { value: string } }) => {
      setValue(e.target.value);
      setError(editor.fieldInput(e.target.value));
    },
  };
  return (
    <>
      {multiline ? (
        <textarea {...shared} rows={3} onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()} />
      ) : (
        <input {...shared} enterKeyHint="done" onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()} />
      )}
      {error && (
        <p className="draw-inspect-error ds-small" role="status">
          {error}
        </p>
      )}
    </>
  );
}

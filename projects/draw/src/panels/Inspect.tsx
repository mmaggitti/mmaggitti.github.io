// The Inspect tab: the selected element's values. P1-M2 adds its sections above P0's attribute
// list ("All attributes", the element's attributes as the file has them):
// - Generator (S1), for one generated shape (engine/generators/): its kind, a field per input with −
//   and + (one entry each), and Detach. A field is one history entry while it has focus: each
//   keystroke that reads as a value is written live (the shape drawn again from it), and Done,
//   Enter, Escape or a blur keeps it.
// Panels only read the editor's stores and call its methods; nothing here writes the document.

import { useEffect, useId, useState } from 'react';
import { decodeAttr } from '../../../../engine/xml/entities.ts';
import type { ElementNode } from '../../../../engine/model/doc.ts';
import type { Editor } from '../editor.ts';
import { INPUT_UI } from '../interact/shapes-tool.ts';
import { elementLabel } from './label.ts';
import { useStore } from './store.ts';

export function Inspect({ editor }: { editor: Editor }) {
  const selection = useStore(editor.selection);
  useStore(editor.version);
  const doc = editor.doc;
  const id = [...selection][0];
  const n = doc && id !== undefined ? doc.nodes.get(id) : undefined;
  if (!doc || !n || n.kind !== 'element') return <p className="draw-empty ds-muted">Select something to see its attributes.</p>;
  const node = n as ElementNode;
  const gen = editor.generated();
  return (
    <div className="draw-inspect">
      {gen && (
        <section className="draw-inspect-section" aria-label="Generator">
          <p className="draw-subhead">{gen.label}</p>
          {gen.inputs.map((i) => (
            <InputRow key={`${gen.id}:${i.name}:${i.text}`} editor={editor} name={i.name} text={i.text} />
          ))}
          <button type="button" className="ds-btn draw-inspect-btn" onClick={() => editor.detach()}>
            Detach
          </button>
        </section>
      )}
      <p className="draw-subhead">All attributes</p>
      <dl className="ds-list draw-attrs">
        <div className="ds-row">
          <dt>element</dt>
          <dd className="ds-mono">{elementLabel(doc, id)}</dd>
        </div>
        {node.attrs.map((a, i) => (
          <div className="ds-row" key={`${i}:${a.qname}`}>
            <dt className="ds-mono">{a.qname}</dt>
            <dd className="ds-mono">{decodeAttr(a.raw, doc.entities)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** One generator input: − , a field, +. */
function InputRow({ editor, name, text }: { editor: Editor; name: string; text: string }) {
  const ui = INPUT_UI[name];
  const field = useId();
  const [value, setValue] = useState(text);
  const [error, setError] = useState<string | null>(null);
  // A field still focused when the row goes (the selection changed) keeps what was typed, as a blur would.
  useEffect(() => () => editor.fieldEnd(), [editor]);
  const label = ui?.label ?? name;
  return (
    <div className="draw-inspect-row">
      <label className="draw-inspect-name" htmlFor={field}>
        {label}
      </label>
      <div className="draw-stepper">
        <button type="button" className="draw-key" aria-label={`Decrease ${label}`} onClick={() => editor.stepInput(name, -1)}>
          −
        </button>
        <input
          id={field}
          className="draw-field ds-mono draw-inspect-field"
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          aria-label={label}
          value={value}
          onFocus={() => editor.fieldStart({ kind: 'input', name })}
          onBlur={() => editor.fieldEnd()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
          }}
          onChange={(e) => {
            setValue(e.target.value);
            setError(editor.fieldInput(e.target.value));
          }}
        />
        <button type="button" className="draw-key" aria-label={`Increase ${label}`} onClick={() => editor.stepInput(name, 1)}>
          +
        </button>
      </div>
      {error && (
        <p className="draw-inspect-error ds-small" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

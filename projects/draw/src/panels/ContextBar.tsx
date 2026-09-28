// The ContextBar (48pt, above the ToolRail): the Scrub strip while a code number is focused (−, the
// value, +, ± for negatives, Done), else the selection and its actions, else a hint. Refused edits
// and other notices show just above it for a few seconds.

import { useEffect } from 'react';
import type { Editor } from '../editor.ts';
import { elementLabel } from './label.ts';
import { useStore } from './store.ts';

const NOTICE_MS = 4000;

export function ContextBar({ editor }: { editor: Editor }) {
  const focus = useStore(editor.focus);
  const selection = useStore(editor.selection);
  const notice = useStore(editor.notice);
  useStore(editor.version);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => editor.notice.set(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice, editor]);

  const ids = [...selection];
  let body;
  if (focus) {
    const t = focus.token;
    body = (
      <div className="draw-strip" role="group" aria-label={`Scrub ${t.prop}`}>
        <span className="draw-strip-name ds-mono">{t.prop}</span>
        <button type="button" className="draw-key" aria-label={`Decrease ${t.prop}`} onClick={() => editor.stepFocus(-1)}>
          −
        </button>
        <button type="button" className="draw-key draw-strip-value ds-mono" aria-label={`Type ${t.prop}: ${t.text}${t.unit ?? ''}`} onClick={() => editor.openNumberSheet()}>
          {t.text}
          {t.unit ?? ''}
        </button>
        <button type="button" className="draw-key" aria-label={`Increase ${t.prop}`} onClick={() => editor.stepFocus(1)}>
          +
        </button>
        <button type="button" className="draw-key" aria-label="Change the sign" onClick={() => editor.negateFocus()}>
          ±
        </button>
        <button type="button" className="draw-key draw-done" onClick={() => editor.clearFocus()}>
          Done
        </button>
      </div>
    );
  } else if (ids.length === 1) {
    body = (
      <>
        <span className="draw-label ds-mono">{elementLabel(editor.doc, ids[0])}</span>
        {editor.canEditSource() && (
          <button type="button" className="draw-key draw-action" onClick={() => editor.openSource()}>
            Edit source
          </button>
        )}
      </>
    );
  } else {
    body = <span className="draw-hint">Tap a shape, or a number in the code.</span>;
  }

  return (
    <div className="draw-context">
      {notice && (
        <p className="draw-toast" role="status">
          {notice}
        </p>
      )}
      {body}
    </div>
  );
}

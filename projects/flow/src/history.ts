// Undo/redo as whole-document snapshots. Cheap at playground sizes, and impossible to get out of
// step with the document the way inverse operations can.
import { useCallback, useRef, useState } from 'react';
import { clean, type Doc } from './doc';

const LIMIT = 100;

export function useHistory(current: () => Doc, apply: (doc: Doc) => void) {
  const past = useRef<Doc[]>([]);
  const future = useRef<Doc[]>([]);
  const [, bump] = useState(0);

  /** Call BEFORE a change: records the document as it is now. */
  const record = useCallback((doc: Doc = current()) => {
    past.current.push(clean(doc));
    if (past.current.length > LIMIT) past.current.shift();
    future.current = [];
    bump((v) => v + 1);
  }, [current]);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(clean(current()));
    apply(prev);
    bump((v) => v + 1);
  }, [current, apply]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(clean(current()));
    apply(next);
    bump((v) => v + 1);
  }, [current, apply]);

  return { record, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}

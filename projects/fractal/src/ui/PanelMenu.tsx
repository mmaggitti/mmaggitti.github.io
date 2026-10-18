import { useEffect, useState } from 'react';
import type { WorkspaceHandle } from '../runtime/workspace.ts';
import type { LayoutDoc } from '../core/types.ts';
import { indexDoc, appsIn } from '../core/tree.ts';
import { kindOf } from '../core/kinds.ts';
import { appTitle } from '../core/nav.ts';
import { addBlock, addGroup, closeCost, closePanel, closeTab, moveTo, type Payload, type Target } from '../core/arrange.ts';

/** Arrange mode's ⋯ sheet for one panel: frame, add, move to, close (asking first when a group's
 * contents would go with it). Every change is one undo step. */
export function PanelMenu({ ws, panel, onClose }: { ws: WorkspaceHandle; panel: string; onClose(): void }) {
  const [step, setStep] = useState<'main' | 'move' | { confirm: string; run(): LayoutDoc | null }>('main');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const doc = ws.getDoc();
  const idx = indexDoc(doc);
  const node = idx.nodes.get(panel);
  if (node?.kind !== 'panel') return null;
  const app = node.selected;
  const rec = doc.apps[app];
  const title = appTitle(doc, app);
  const isGroup = !!rec && kindOf(rec.kind).hosts;
  const payload: Payload = { kind: 'panel', panel };

  const run = (next: LayoutDoc | null | undefined) => {
    ws.apply(next ?? null);
    onClose();
  };
  const where: Record<'tab' | 'right' | 'below', Target> = {
    tab: { kind: 'tab', panel, index: node.tabs.length },
    right: { kind: 'edge', node: panel, side: 'right' },
    below: { kind: 'edge', node: panel, side: 'bottom' },
  };
  const inside: Target | null = !isGroup ? null : rec.dock ? { kind: 'edge', node: rec.dock.id, side: 'bottom' } : { kind: 'dock', host: app };

  const closeWith = (what: Payload, label: string, close: () => LayoutDoc | null) => {
    const cost = closeCost(doc, what, idx);
    if (cost === 0) run(close());
    else setStep({ confirm: `Close ${label} and the ${cost} ${cost === 1 ? 'thing' : 'things'} inside?`, run: close });
  };

  let body;
  if (typeof step === 'object') {
    body = (
      <>
        <p className="fx-menu-title">{step.confirm}</p>
        <div className="fx-menu-row">
          <button type="button" className="ds-btn" onClick={() => setStep('main')}>
            Keep
          </button>
          <button type="button" className="ds-btn ds-btn--primary" onClick={() => run(step.run())}>
            Close
          </button>
        </div>
      </>
    );
  } else if (step === 'move') {
    // Every group, plus the top level; the ones inside this panel (a cycle) or where it already is
    // come out disabled.
    const carried = new Set(appsIn(doc, node));
    const groups = Object.keys(doc.apps).filter((id) => kindOf(doc.apps[id].kind).hosts && idx.panelOf.has(id));
    const dests: { id: string | null; label: string }[] = [{ id: null, label: 'Top level' }, ...groups.map((id) => ({ id, label: appTitle(doc, id) }))];
    body = (
      <>
        <p className="fx-menu-title">Move {title} to…</p>
        {dests.map((d) => {
          const next = d.id !== null && carried.has(d.id) ? null : moveTo(doc, payload, d.id, idx);
          return (
            <button key={d.id ?? ''} type="button" className="ds-btn" data-dest={d.id ?? ''} disabled={!next || next === doc} onClick={() => run(next)}>
              {d.label}
            </button>
          );
        })}
        <button type="button" className="ds-btn" onClick={() => setStep('main')}>
          Back
        </button>
      </>
    );
  } else {
    body = (
      <>
        <p className="fx-menu-title">
          {title}
          {node.tabs.length > 1 && <span className="ds-muted"> +{node.tabs.length - 1}</span>}
        </p>
        <button
          type="button"
          className="ds-btn"
          onClick={() => {
            onClose();
            ws.frame(panel);
          }}
        >
          Frame
        </button>
        <span className="fx-menu-label ds-small ds-muted">Add block</span>
        <div className="fx-menu-row" role="group" aria-label="Add block">
          <button type="button" className="ds-btn" onClick={() => run(addBlock(doc, where.tab)?.doc)}>
            As tab
          </button>
          <button type="button" className="ds-btn" onClick={() => run(addBlock(doc, where.right)?.doc)}>
            Right
          </button>
          <button type="button" className="ds-btn" onClick={() => run(addBlock(doc, where.below)?.doc)}>
            Below
          </button>
        </div>
        <span className="fx-menu-label ds-small ds-muted">Add group</span>
        <div className="fx-menu-row" role="group" aria-label="Add group">
          <button type="button" className="ds-btn" onClick={() => run(addGroup(doc, where.tab)?.doc)}>
            As tab
          </button>
          <button type="button" className="ds-btn" onClick={() => run(addGroup(doc, where.right)?.doc)}>
            Right
          </button>
          <button type="button" className="ds-btn" onClick={() => run(addGroup(doc, where.below)?.doc)}>
            Below
          </button>
        </div>
        {inside && (
          <button type="button" className="ds-btn" onClick={() => run(addBlock(doc, inside)?.doc)}>
            Add block inside {title}
          </button>
        )}
        <button type="button" className="ds-btn" onClick={() => setStep('move')}>
          Move to…
        </button>
        {node.tabs.length > 1 && (
          <button type="button" className="ds-btn" onClick={() => closeWith({ kind: 'tab', app }, title, () => closeTab(doc, app, idx))}>
            Close tab {title}
          </button>
        )}
        <button type="button" className="ds-btn" onClick={() => closeWith(payload, node.tabs.length > 1 ? 'this panel' : title, () => closePanel(doc, panel, idx))}>
          Close panel
        </button>
      </>
    );
  }

  return (
    <div className="fx-sheet fx-menu" role="dialog" aria-label="Panel menu">
      {body}
      {step === 'main' && (
        <button type="button" className="ds-btn" onClick={onClose}>
          Cancel
        </button>
      )}
    </div>
  );
}

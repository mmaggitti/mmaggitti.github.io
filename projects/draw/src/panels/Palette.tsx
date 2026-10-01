// The command palette (P1-M5): ⌘K, or the top bar's Commands. Every command that applies now, from
// the registry (src/commands.ts), under its group's subhead; typing filters them to a flat list (every
// word typed, in a name or a group). ↓ and ↑ move the active row, Return runs it (the first, at
// first), a tap runs its row, Escape closes. A run closes the palette first, so a command that opens a
// sheet opens it over nothing.
//
// Opened by ⌘K its field takes the focus; opened by a tap it doesn't (on a phone a focused field would
// raise the keyboard over the list), and a tap on the field does. It is a Modal, so a tap's late
// mouse events (WebKit delivers them after what the tap opened) neither close it nor run a row.

import { Fragment, useEffect, useRef, useState } from 'react';
import { keyHint, search, type Command, type Ctx } from '../commands.ts';
import { Modal } from './Sheets.tsx';
import { useStore } from './store.ts';
import type { PanelUi } from './ui.ts';

export function Palette({ ctx, ui }: { ctx: Ctx; ui: PanelUi }) {
  const open = useStore(ui.paletteOpen);
  if (!open) return null;
  return <PaletteSheet ctx={ctx} focus={open.focus} close={() => ui.paletteOpen.set(null)} />;
}

function PaletteSheet({ ctx, focus, close }: { ctx: Ctx; focus: boolean; close: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // What applies follows the drawing, the selection and the tool.
  useStore(ctx.editor.version);
  useStore(ctx.editor.selection);
  useStore(ctx.editor.tool);
  useStore(ctx.editor.history);
  const rows = search(query, ctx);
  const at = Math.min(active, Math.max(0, rows.length - 1));
  const run = (c: Command) => {
    close();
    c.run(ctx);
  };

  useEffect(() => {
    if (focus) field.current?.focus();
  }, [focus]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1))));
      } else if (e.key === 'Enter' && !e.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey && !(e.target as Element | null)?.closest?.('.draw-palette-row')) {
        // (Return on a focused row is that row's own click.)
        e.preventDefault();
        if (rows[at]) run(rows[at]);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [at, query]);

  const row = (c: Command, i: number) => (
    <button key={c.id} id={`draw-cmd-${c.id}`} type="button" role="option" aria-selected={i === at} className="ds-btn draw-palette-row" onClick={() => run(c)}>
      <span className="draw-palette-name">{c.name}</span>
      {keyHint(c) && <span className="draw-palette-key ds-mono ds-small">{keyHint(c)}</span>}
    </button>
  );
  // Nothing typed: under the groups' subheads, in registry order.
  const groups: { group: string; rows: [Command, number][] }[] = [];
  if (!query.trim()) rows.forEach((c, i) => (groups.at(-1)?.group === c.group ? groups.at(-1)!.rows.push([c, i]) : groups.push({ group: c.group, rows: [[c, i]] })));
  return (
    <Modal title="Commands" onClose={close} done mono={false}>
      <div className="draw-palette">
        <input
          ref={field}
          type="search"
          className="draw-field draw-palette-field"
          aria-label="Search commands"
          aria-controls="draw-palette-list"
          aria-activedescendant={rows[at] ? `draw-cmd-${rows[at].id}` : undefined}
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
        <div ref={list} id="draw-palette-list" className="draw-palette-list" role="listbox" aria-label="Commands">
          {query.trim()
            ? rows.map(row)
            : groups.map((g) => (
                <Fragment key={g.group}>
                  <p className="draw-subhead" aria-hidden="true">
                    {g.group}
                  </p>
                  {g.rows.map(([c, i]) => row(c, i))}
                </Fragment>
              ))}
          {!rows.length && <p className="ds-muted draw-palette-none">No command matches.</p>}
        </div>
      </div>
    </Modal>
  );
}

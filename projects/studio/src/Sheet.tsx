import { label } from './dom';
import { Inspector } from './Inspector';
import { selection, sheetSize, sheetTab, type SheetSize } from './selection';
import { useFrameVersion } from './frame';
import { useStore } from './store';
import { Tree } from './Tree';

const NEXT: Record<SheetSize, SheetSize> = { peek: 'half', half: 'full', full: 'peek' };
const SIZE_LABEL: Record<SheetSize, string> = { peek: 'Show more', half: 'Expand panel', full: 'Collapse panel' };

// The bottom sheet over the canvas: Tree and Inspect tabs, three heights stepped by the handle.
export function Sheet() {
  const tab = useStore(sheetTab);
  const size = useStore(sheetSize);
  const selected = useStore(selection);
  useFrameVersion('structure'); // the label follows id and class changes on the selection

  return (
    <section className={`sheet sheet--${size}`} aria-label="Inspector panel">
      <div className="sheet-head">
        <button
          type="button"
          className="sheet-handle"
          aria-label={SIZE_LABEL[size]}
          onClick={() => sheetSize.set(NEXT[size])}
        >
          <span className="sheet-grip" aria-hidden="true" />
        </button>
        <div className="sheet-row">
          <div className="ds-seg sheet-tabs" role="group" aria-label="Panel">
            <button type="button" aria-pressed={tab === 'tree'} onClick={() => sheetTab.set('tree')}>
              Tree
            </button>
            <button type="button" aria-pressed={tab === 'inspect'} onClick={() => sheetTab.set('inspect')}>
              Inspect
            </button>
          </div>
          <span className="sheet-sel ds-mono" aria-live="polite">
            {selected && selected.isConnected ? label(selected) : 'nothing selected'}
          </span>
        </div>
      </div>
      {size !== 'peek' && (
        <div className="sheet-body">
          {tab === 'tree' ? <Tree /> : <Inspector />}
        </div>
      )}
    </section>
  );
}

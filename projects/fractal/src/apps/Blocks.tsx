// Placeholder content while the workspace itself is the subject: a blank coloured block, and a
// group's band (a hosting app's own UI, above its dock). Neither holds any state.

import type { CSSProperties } from 'react';

export function Block({ title, hue }: { title: string; hue: number | null }) {
  const style = hue === null ? undefined : ({ '--hue': String(hue) } as CSSProperties);
  return (
    <div className="block" data-hue={hue ?? undefined} style={style}>
      <span className="block-name">{title}</span>
    </div>
  );
}

export function GroupBand({ title }: { title: string }) {
  return (
    <div className="band">
      <strong>{title}</strong>
    </div>
  );
}

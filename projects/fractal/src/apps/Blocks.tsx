// Placeholder content while the workspace itself is the subject: a blank block, pure colour. Its
// name lives in its caption (and in the capsule when it's framed). It holds no state.

import type { CSSProperties } from 'react';

export function Block({ hue }: { hue: number | null }) {
  const style = hue === null ? undefined : ({ '--hue': String(hue) } as CSSProperties);
  return <div className="block" data-hue={hue ?? undefined} style={style} />;
}

// The phone's copy of the drawing. One key, prefixed per the site's shared-origin rule.
import { clean, parseDoc, type Doc } from './doc';

const KEY = 'flow:doc';

export function load(): Doc | null {
  try {
    const text = localStorage.getItem(KEY);
    return text ? parseDoc(text) : null;
  } catch {
    return null; // blocked storage or a damaged copy: start fresh rather than fail
  }
}

export function save(doc: Doc): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(clean(doc)));
  } catch {
    // private mode or a full quota; the drawing still works, it just won't survive a reload
  }
}

export function download(doc: Doc): void {
  const blob = new Blob([JSON.stringify({ app: 'flow', version: 1, ...clean(doc) }, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'flow.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

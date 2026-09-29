// Whether a drawing's CSS moves (src/canvas/renderer.ts): under reduced motion a drawing that moves
// opens paused with Play over it, so a still one must never be taken for one that moves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cssAnimates } from '../../src/canvas/renderer.ts';

test('CSS moves with @keyframes, or an animation or animation-name that is not none; a class named for it, or animation: none, is still', () => {
  for (const css of ['@keyframes spin { to { transform: rotate(1turn) } }', '.sun { animation: spin 4s linear infinite }', 'animation-name: pulse', 'rect{fill:teal;ANIMATION:fade 1s}', 'animation: none, spin 2s']) {
    assert.ok(cssAnimates(css), css);
  }
  for (const css of ['.animation-frame { fill: teal }', '.animation:hover { fill: red }', 'animation: none', 'rect { animation: none; fill: teal }', 'animation-name: none !important', 'animation-delay: 1s', 'fill: #2a9d8f']) {
    assert.ok(!cssAnimates(css), css);
  }
});

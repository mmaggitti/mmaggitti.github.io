// The renderer and the engine's model, bundled on the fly by test/renderer-patch.mjs so a test page
// can drive the real Renderer through edits (the app exposes only drawTest.render), and route them
// as the editor does (the engine's place ops and src/routing.ts).

import { attrSnapshot, el, parseDoc, removeAttr, restoreAttr, setAttr } from '../../../../engine/model/doc.ts';
import { emptyChangeSet, noteChange, opInsert, opRemove } from '../../../../engine/commands/ops.ts';
import { Renderer } from '../../src/canvas/renderer.ts';
import { sinkReady } from '../../src/canvas/safe-sink.ts';
import { route } from '../../src/routing.ts';

Object.assign(window, { drawHarness: { attrSnapshot, el, parseDoc, removeAttr, restoreAttr, setAttr, emptyChangeSet, noteChange, opInsert, opRemove, route, Renderer, sinkReady } });

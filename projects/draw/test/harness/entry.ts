// The renderer and the engine's model, bundled on the fly by test/renderer-patch.mjs so a test page
// can drive the real Renderer through edits (the app exposes only drawTest.render).

import { el, parseDoc, removeAttr, setAttr } from '../../../../engine/model/doc.ts';
import { Renderer } from '../../src/canvas/renderer.ts';
import { sinkReady } from '../../src/canvas/safe-sink.ts';

Object.assign(window, { drawHarness: { el, parseDoc, removeAttr, setAttr, Renderer, sinkReady } });

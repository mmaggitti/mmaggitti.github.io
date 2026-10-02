// Flow end-to-end test, run by scripts/smoke-test.mjs against the built site
// (Chromium in the cloud container, WebKit in CI). Throws on the first failure.
//
// Geometry is asserted, not just counts: a new node must land inside the canvas, Tidy must leave
// no two nodes overlapping and every edge pointing down, and the bar must sit above the screen edge.

import { readFileSync } from 'node:fs';

const TOLERANCE = 1; // px

export default async function run({ browser, origin }) {
  const context = await browser.newContext({
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce', // fitView jumps instead of animating, so boxes can be read at once
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console error: ${m.text()}`));

  try {
    await page.goto(`${origin}/flow/`, { waitUntil: 'networkidle' });
    const bar = page.locator('nav.flow-bar');
    const button = (name) => bar.getByRole('button', { name, exact: true });
    const sheetButton = (name) => page.locator('.flow-sheet').getByRole('button', { name, exact: true });
    const node = (id) => page.locator(`.react-flow__node[data-id="${id}"]`);
    const count = page.getByTestId('count');
    const expectCount = (text) => waitFor(async () => (await count.innerText()) === text, async () => `count is "${await count.innerText()}", expected "${text}"`);

    // 1. The starter drawing: 5 nodes, 3 edges, all inside the canvas; no sideways scroll.
    await node('n1').waitFor();
    await expectCount('5 nodes · 3 edges');
    must((await page.locator('.react-flow__node').count()) === 5, 'starter: not 5 node elements');
    must((await page.locator('.react-flow__edge').count()) === 3, 'starter: not 3 edge elements');
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    must(sideways === 0, `page scrolls sideways by ${sideways}px`);
    const canvas = await page.locator('.flow-canvas').boundingBox();
    for (const id of ['n1', 'n2', 'n3', 'n4', 'n5']) await inside(node(id), canvas, `starter ${id}`);

    // 2. The bar: every button at least 44px tall, wholly on screen, below the canvas.
    const buttons = await bar.getByRole('button').all();
    must(buttons.length === 5, `bar has ${buttons.length} buttons, expected 5`);
    for (const b of buttons) {
      const box = await b.boundingBox();
      const name = await b.innerText();
      must(box.height >= 44 - TOLERANCE, `bar button ${name} is ${box.height}px tall`);
      must(box.y + box.height <= 956 + TOLERANCE, `bar button ${name} runs off the bottom`);
      must(box.y >= canvas.y + canvas.height - TOLERANCE, `bar button ${name} overlaps the canvas`);
    }

    // 3. Add a Step: one more node, drawn inside the canvas, and selected (the bar offers Edit).
    await button('Add').tap();
    await sheetButton('Step').tap();
    await expectCount('6 nodes · 3 edges');
    await inside(node('n6'), canvas, 'added n6');
    must((await node('n6').innerText()).trim() === 'Step', 'added node is not labelled Step');
    await button('Edit').waitFor();

    // 4. Edit its label from the sheet.
    await button('Edit').tap();
    await page.getByRole('textbox', { name: 'Label' }).fill('Renamed');
    await sheetButton('Save').tap();
    await waitFor(async () => (await node('n6').innerText()).trim() === 'Renamed', 'label edit did not apply');

    // 5. Undo and redo walk the history both ways.
    await button('Undo').tap();
    await waitFor(async () => (await node('n6').innerText()).trim() === 'Step', 'undo did not restore the label');
    await button('Undo').tap();
    await expectCount('5 nodes · 3 edges');
    must((await node('n6').count()) === 0, 'undo left the added node');
    await button('Redo').tap();
    await expectCount('6 nodes · 3 edges');
    await button('Redo').tap();
    await waitFor(async () => (await node('n6').innerText()).trim() === 'Renamed', 'redo did not reapply the label');
    must(await button('Redo').isDisabled(), 'Redo still enabled at the end of history');

    // 6. Connect by dragging from n6's bottom dot to n1's top dot.
    await drag(page, node('n6').locator('.react-flow__handle.source'), node('n1').locator('.react-flow__handle.target'));
    await expectCount('6 nodes · 4 edges');

    // 7. Delete n6: its edge goes with it.
    await node('n6').click();
    await button('Delete').tap();
    await expectCount('5 nodes · 3 edges');

    // 8. Tidy: positions change, no two nodes overlap, every edge runs top to bottom.
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } }); // clear the selection
    await button('Tidy').waitFor();
    const before = await boxes(page);
    await button('Tidy').tap();
    await waitFor(async () => {
      const after = await boxes(page);
      return Object.keys(after).some((id) => Math.abs(after[id].x - before[id].x) > TOLERANCE || Math.abs(after[id].y - before[id].y) > TOLERANCE);
    }, 'Tidy moved nothing');
    await layered(page, canvas, 'after Tidy');

    // 9. It survives a reload (localStorage "flow:doc"), layout and all.
    await page.waitForTimeout(400); // past the autosave debounce
    await page.reload({ waitUntil: 'networkidle' });
    await node('n1').waitFor();
    await expectCount('5 nodes · 3 edges');
    await layered(page, canvas, 'after reload');

    // 10. Export: the downloaded file holds the same drawing.
    await button('More').tap();
    const [download] = await Promise.all([page.waitForEvent('download'), sheetButton('Export JSON').tap()]);
    const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
    must(exported.nodes?.length === 5 && exported.edges?.length === 3, `export holds ${exported.nodes?.length} nodes, ${exported.edges?.length} edges`);
    must(exported.nodes.every((n) => !('selected' in n) && !('measured' in n)), 'export carries view state');

    // 11. Import: a good file replaces the drawing (and undo brings the old one back); a bad one is refused.
    const file = (name, text) => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
    const good = {
      nodes: [
        { id: 'a', type: 'decision', position: { x: 0, y: 0 }, data: { label: 'From a file' } },
        { id: 'b', type: 'not-a-kind', position: { x: 0, y: 120 }, data: { label: 'B' } },
      ],
      edges: [{ id: 'ab', source: 'a', target: 'b' }],
    };
    await page.getByTestId('import').setInputFiles(file('good.json', JSON.stringify(good)));
    await expectCount('2 nodes · 1 edge');
    must((await page.locator('.react-flow__node.react-flow__node-process[data-id="b"]').count()) === 1, 'unknown kind was not mapped to a Step');
    await inside(node('a'), canvas, 'imported a');
    await button('Undo').tap();
    await expectCount('5 nodes · 3 edges');
    await page.getByTestId('import').setInputFiles(file('bad.json', '{"nodes": [{"id": "x"}], "edges": []}'));
    await waitFor(async () => (await page.getByRole('status').innerText()).startsWith("Couldn't import"), 'a malformed file was not refused');
    await expectCount('5 nodes · 3 edges');

    must(errors.length === 0, errors.join('\n'));
  } finally {
    await context.close();
  }
}

async function boxes(page) {
  return page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll('.react-flow__node'), (el) => {
        const r = el.getBoundingClientRect();
        return [el.getAttribute('data-id'), { x: r.x, y: r.y, width: r.width, height: r.height }];
      }),
    ),
  );
}

// No two nodes overlap, every edge's source sits wholly above its target, and all are on screen.
// Retried until it holds (React Flow fits the view a frame or two after the nodes move), and on
// timeout it reports the last thing that was wrong.
async function layered(page, canvas, when) {
  let problem;
  await waitFor(async () => (problem = await layoutProblem(page, canvas)) === null, () => `${when}: ${problem}`);
}

async function layoutProblem(page, canvas) {
  const b = await boxes(page);
  const ids = Object.keys(b);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [p, q] = [b[ids[i]], b[ids[j]]];
      const apart = p.x + p.width <= q.x + TOLERANCE || q.x + q.width <= p.x + TOLERANCE || p.y + p.height <= q.y + TOLERANCE || q.y + q.height <= p.y + TOLERANCE;
      if (!apart) return `${ids[i]} ${fmt(p)} overlaps ${ids[j]} ${fmt(q)}`;
    }
  }
  const edges = await page.evaluate(() => JSON.parse(localStorage.getItem('flow:doc') ?? '{"edges":[]}').edges);
  for (const e of edges) {
    if (b[e.source].y + b[e.source].height > b[e.target].y + TOLERANCE) return `edge ${e.source}→${e.target} doesn't run downward`;
  }
  for (const id of ids) if (!isWithin(b[id], canvas)) return `${id} ${fmt(b[id])} is not inside the canvas ${fmt(canvas)}`;
  return null;
}

async function inside(locator, canvas, what) {
  let box;
  await waitFor(async () => {
    box = await locator.boundingBox();
    return box && isWithin(box, canvas);
  }, () => `${what}: ${fmt(box)} is not inside the canvas ${fmt(canvas)}`);
}

function isWithin(box, c) {
  return box.x >= c.x - TOLERANCE && box.y >= c.y - TOLERANCE && box.x + box.width <= c.x + c.width + TOLERANCE && box.y + box.height <= c.y + c.height + TOLERANCE;
}

async function drag(page, from, to) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  must(a && b, 'drag: a handle is not on screen');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
}

function must(cond, message) {
  if (!cond) throw new Error(message);
}

async function waitFor(fn, message, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(typeof message === 'function' ? await message() : message);
}

function fmt(r) {
  return r ? `${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.width.toFixed(1)}×${r.height.toFixed(1)}` : 'none';
}

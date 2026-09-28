// Core & Seams specimen: renders hue candidates, swatches and spacing from the generated tokens,
// and wires the preview controls. Settings persist per viewer under the "core-and-seams:" prefix.
import { tokens } from '../generated/tokens.js';

const $ = (sel) => document.querySelector(sel);
const root = document.documentElement;
const store = {
  get(k) { try { return localStorage.getItem(`core-and-seams:${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`core-and-seams:${k}`, v); } catch { /* private mode */ } },
};

// ── colour maths (WCAG), for the numbers printed on swatches ──
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const mode = () => {
  const forced = root.dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

// ── hue candidates: one mini screen per hue, with that hue's roles set inline ──
function renderMocks() {
  const m = mode();
  const neutrals = tokens.neutrals[m];
  $('#mocks').replaceChildren(...Object.entries(tokens.hues).map(([name, hue]) => {
    const ramp = hue[m];
    const card = document.createElement('article');
    card.className = 'cs-panel spec-mock';
    for (const [k, v] of Object.entries(ramp)) card.style.setProperty(`--${k}`, v);
    const onAccent = ratio(ramp['on-accent'], ramp.accent).toFixed(1);
    card.innerHTML = `
      <p class="cs-kicker">${name}${name === tokens.defaultHue ? ' · default' : ''}</p>
      <p class="cs-title">Week 4 · Control flow</p>
      <span class="cs-meter" role="presentation"><span style="--value: 40%"></span></span>
      <div class="cs-panel cs-panel--tint cs-small">br_if exits the block with label 0 when the condition holds.</div>
      <span class="spec-mock__link">Continue where you left off ›</span>
      <button class="cs-btn cs-btn--primary" type="button">Start review</button>
      <p class="spec-note">Label on accent ${onAccent}:1 · accent on surface ${ratio(ramp.accent, neutrals.surface).toFixed(1)}:1</p>`;
    return card;
  }));
}

// ── swatches ──
function swatch(name, hex, textOn) {
  const el = document.createElement('div');
  el.className = 'spec-swatch';
  el.innerHTML = `<div class="spec-swatch__chip" style="background:${hex}"></div>
    <div class="spec-swatch__meta"><strong>${name}</strong><br><span class="cs-mono">${hex}</span><br><span class="cs-muted">${textOn}</span></div>`;
  return el;
}
function renderSwatches() {
  const m = mode();
  const n = tokens.neutrals[m];
  $('#neutrals').replaceChildren(...Object.entries(n).filter(([k]) => k !== 'scrim').map(([k, v]) =>
    swatch(k, v, `ink ${ratio(n.ink, v).toFixed(1)} · muted ${ratio(n.muted, v).toFixed(1)}`)));
  const s = tokens.status;
  $('#status').replaceChildren(...['ok', 'warn', 'danger'].map((k) => swatch(`status-${k}`, s[k], `ink ${ratio(s.ink, s[k]).toFixed(1)}`)));
  const hueName = root.dataset.hue || tokens.defaultHue;
  const { data, dataDropped } = tokens.hues[hueName];
  $('#data').replaceChildren(...Object.entries(data).map(([k, v]) => swatch(`data-${k}`, v, `ink ${ratio(s.ink, v).toFixed(1)}`)));
  $('#data-note').textContent = dataDropped
    ? `With the "${hueName}" hue, data-${dataDropped} is left out: it's the pack colour nearest the accent (EF §11.3 step 5).`
    : `The "${hueName}" hue is near-neutral, so the full pack stays.`;
}

function renderSpace() {
  $('#space').replaceChildren(...Object.entries(tokens.space).map(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'spec-space__row';
    row.innerHTML = `<span class="cs-mono" style="width: 5rem">space-${k}</span><span class="spec-space__bar" style="width: ${v}"></span><span class="cs-muted">${v}</span>`;
    return row;
  }));
}

// Compact density preview: set the compact values on one panel, whatever this device is.
for (const [k, v] of Object.entries(tokens.density.compact)) $('#dense-compact').style.setProperty(`--${k}`, v);
for (const [k, v] of Object.entries(tokens.density.comfortable)) {
  $('#dense-comfortable').style.setProperty(`--${k}`, ['control-h', 'control-h-sm', 'row-h'].includes(k) ? `max(var(--tap-min), ${v})` : v);
}

// ── controls ──
const hueSeg = $('#hue-seg');
for (const name of Object.keys(tokens.hues)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.value = name;
  b.textContent = name;
  hueSeg.append(b);
}

const apply = {
  theme(v) { if (v === 'auto') delete root.dataset.theme; else root.dataset.theme = v; },
  scale(v) { root.style.setProperty('--ui-scale', v); },
  hue(v) { $('#hue-css').href = `generated/hues/${v}.css`; root.dataset.hue = v; },
};
const defaults = { theme: 'auto', scale: String(tokens.uiScale), hue: tokens.defaultHue };

function select(control, value) {
  apply[control](value);
  store.set(control, value);
  for (const b of document.querySelectorAll(`[data-control="${control}"] > button`)) b.setAttribute('aria-pressed', String(b.dataset.value === value));
  renderMocks();
  renderSwatches();
}
for (const seg of document.querySelectorAll('[data-control]')) {
  const control = seg.dataset.control;
  seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) select(control, b.dataset.value); });
  const saved = store.get(control);
  const valid = [...seg.querySelectorAll('button')].some((b) => b.dataset.value === saved);
  select(control, valid ? saved : defaults[control]);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { renderMocks(); renderSwatches(); });

// Sheet and dialog.
for (const b of document.querySelectorAll('[data-open]')) b.addEventListener('click', () => document.getElementById(b.dataset.open).showModal());
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());

const coarse = matchMedia('(any-pointer: coarse)').matches;
$('#pointer-note').textContent = coarse ? 'touch · comfortable' : 'pointer · compact';
renderSpace();

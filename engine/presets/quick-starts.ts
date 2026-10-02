// The New sheet's presets (P1-M5): Draw's blank artboard, three quick starts, and SVG Lab's Create
// templates exactly as the lab exports them. Pure data: the workspace opens one as a new drawing, or
// writes one over the open drawing's content (Replace this one), and node's tests hold each to its bytes.
//
// - The quick starts are plain starts, kept in this one module so a change is one edit:
//   - Icon, 24 × 24: a stroke icon's artboard, the root attributes of the corpus's 24 × 24 stroke icon
//     sets (icons/lucide) without their class: no fill, currentColor, width 2, round caps and joins;
//   - App icon, 1024 × 1024: a rounded square (corner radius 224) in SVG Lab's ink, #264653;
//   - Wordmark, 640 × 200: a word in Archivo 900, centred, its attributes in the order the Text tool
//     writes them (SVG Lab's KITS.text), y = 100 + 0.35 × 96 rounded (the Text tool's middle rule).
// - SVG Lab's Blank, Icon and Logo are its exports of TPL.blank, TPL.icon and TPL.logo, byte for byte as
//   tools/capture-lab-corpus.mjs captured them (engine/test/fixtures/corpus/lab/create-*.svg); a test
//   compares them, so a recaptured lab is noticed.
// Each text ends with a newline, as a saved file does.

export type PresetGroup = 'draw' | 'quick' | 'lab';

export interface Preset {
  /** Stable kebab-case: the New sheet's data-preset. */
  id: string;
  group: PresetGroup;
  /** The New sheet's row. */
  name: string;
  /** Its artboard, as the row shows it. */
  size: string;
  /** The name a new drawing from it gets (its files are <drawing>.svg). */
  drawing: string;
  /** The file, byte for byte. */
  text: string;
}

/** Draw's blank artboard: New, and the New sheet's Blank. */
export const BLANK = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">\n</svg>\n';

// SVG Lab's exports of its Create templates (lab/create-blank.svg, create-icon.svg, create-logo.svg).
const LAB_BLANK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
</svg>
`;
const LAB_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect
    x="12"
    y="12"
    width="76"
    height="76"
    rx="18"
    fill="#264653"
    stroke="none"/>
  <path
    d="M 50 40
   C 50 32, 37 28, 32 37
   C 27 45, 36 57, 50 70
   C 64 57, 73 45, 68 37
   C 63 28, 50 32, 50 40
   Z"
    fill="#e76f51"
    stroke="none"/>
</svg>
`;
const LAB_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="40" r="24" fill="#e9c46a" stroke="none"/>
  <path
    d="M 30 44
   Q 40 32, 50 44
   Q 60 56, 70 44"
    fill="none"
    stroke="#264653"
    stroke-width="4"
    stroke-linecap="round"
    stroke-linejoin="round"/>
  <text
    x="50"
    y="84"
    font-size="11"
    font-family="sans-serif"
    font-weight="900"
    text-anchor="middle"
    fill="#264653">SUNWAVE</text>
</svg>
`;

export const PRESETS: readonly Preset[] = [
  { id: 'draw-blank', group: 'draw', name: 'Blank', size: '800 × 600', drawing: 'Blank', text: BLANK },
  {
    id: 'quick-icon-24', group: 'quick', name: 'Icon', size: '24 × 24', drawing: 'Icon',
    text: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n</svg>\n',
  },
  {
    id: 'quick-app-icon', group: 'quick', name: 'App icon', size: '1024 × 1024', drawing: 'App icon',
    text: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n  <rect width="1024" height="1024" rx="224" fill="#264653"/>\n</svg>\n',
  },
  {
    id: 'quick-wordmark', group: 'quick', name: 'Wordmark', size: '640 × 200', drawing: 'Wordmark',
    text: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200">\n  <text x="320" y="134" font-size="96" font-family="Archivo, sans-serif" font-weight="900" text-anchor="middle" fill="#264653">Wordmark</text>\n</svg>\n',
  },
  { id: 'lab-blank', group: 'lab', name: 'Blank', size: '100 × 100', drawing: 'SVG Lab blank', text: LAB_BLANK },
  { id: 'lab-icon', group: 'lab', name: 'Icon', size: '100 × 100', drawing: 'SVG Lab icon', text: LAB_ICON },
  { id: 'lab-logo', group: 'lab', name: 'Logo', size: '100 × 100', drawing: 'SVG Lab logo', text: LAB_LOGO },
];

/** The New sheet's groups, in order, with their headings. */
export const PRESET_GROUPS: readonly { group: PresetGroup; heading: string }[] = [
  { group: 'draw', heading: 'Blank' },
  { group: 'quick', heading: 'Quick starts' },
  { group: 'lab', heading: 'SVG Lab’s templates' },
];

/** A preset by id, or undefined. */
export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id);

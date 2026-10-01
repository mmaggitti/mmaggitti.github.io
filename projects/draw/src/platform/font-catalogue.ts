// Draw's fonts (P1-M4): the families the Font sheet offers under "Draw's fonts", each from its
// @fontsource package (5.3.0, OFL-1.1), every latin face the package has, upright and italic (Mark,
// 2026-10-01: every weight). Pure data, so node's tests and the editor read it; the files themselves
// are emitted by Vite and found by URL only in font-files.ts, which src/platform/fonts.ts loads lazily:
// nothing is fetched until a drawing uses a face or the Font sheet shows the family.
//
// To add a font:
// 1. install its package with an exact pin: `npm install --save-exact @fontsource/<slug>@<version>`
//    (as `dependencies`: its files ship), and commit the lock;
// 2. add its entry below: family, slug, generic (its metadata.json category; handwriting is cursive),
//    its weights and italics (every latin .woff2 in its files/), its copyright line (its LICENSE's
//    first), and its Reserved Font Names, each with its source, from the font's upstream licence (a
//    package's LICENSE can leave them out, as @fontsource's IBM Plex does);
// 3. then test/unit/font-catalogue.test.ts checks its faces against the package's files and its
//    generic against its category, and test/unit/notices.test.ts asks for its licence in
//    public/THIRD-PARTY-NOTICES.txt. Nothing in the UI changes: the Font sheet, Inspect's Weight and
//    Style, and the Text tool's choices read this list.

export type Generic = 'sans-serif' | 'serif' | 'monospace' | 'cursive';

export interface CatalogueFamily {
  family: string;
  slug: string;
  generic: Generic;
  /** The weights of its upright faces, and of its italic ones. */
  weights: readonly number[];
  italics: readonly number[];
  /** Its copyright line (the package's LICENSE, first line), for an export that embeds it. */
  copyright: string;
  /** Its Reserved Font Names (OFL 1.1): a face of it is never embedded in an export (S2). */
  reserved: readonly string[];
}

const ALL = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const upTo = (w: number) => ALL.filter((x) => x <= w);

export const CATALOGUE: readonly CatalogueFamily[] = [
  // Omnibus-Type/Archivo OFL.txt and Google Fonts' ofl/archivo/OFL.txt name no Reserved Font Name.
  { family: 'Archivo', slug: 'archivo', generic: 'sans-serif', weights: ALL, italics: ALL, copyright: 'Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo)', reserved: [] },
  // "Plex": IBM/plex LICENSE.txt line 1 and Google Fonts' ofl/ibmplexmono/OFL.txt line 1 ("with Reserved
  // Font Name "Plex""); @fontsource's LICENSE and the font's own name table leave it out.
  { family: 'IBM Plex Mono', slug: 'ibm-plex-mono', generic: 'monospace', weights: upTo(700), italics: upTo(700), copyright: 'Copyright 2017 IBM Corp. All rights reserved.', reserved: ['Plex'] },
  // rsms/inter LICENSE.txt and Google Fonts' OFL.txt name none.
  { family: 'Inter', slug: 'inter', generic: 'sans-serif', weights: ALL, italics: ALL, copyright: 'Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)', reserved: [] },
  // "Plex": as IBM Plex Mono (Google Fonts' ofl/ibmplexsans/OFL.txt line 1); left out by @fontsource.
  { family: 'IBM Plex Sans', slug: 'ibm-plex-sans', generic: 'sans-serif', weights: upTo(700), italics: upTo(700), copyright: 'Copyright 2019 IBM Corp. All rights reserved.', reserved: ['Plex'] },
  // floriankarsten/space-grotesk OFL.txt names none.
  { family: 'Space Grotesk', slug: 'space-grotesk', generic: 'sans-serif', weights: [300, 400, 500, 600, 700], italics: [], copyright: 'Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)', reserved: [] },
  // dharmatype/Bebas-Neue OFL.txt names none.
  { family: 'Bebas Neue', slug: 'bebas-neue', generic: 'sans-serif', weights: [400], italics: [], copyright: 'Copyright 2019 The Bebas Neue Project Authors (https://github.com/dharmatype/Bebas-Neue)', reserved: [] },
  // undercasetype/Fraunces OFL.txt names none.
  { family: 'Fraunces', slug: 'fraunces', generic: 'serif', weights: ALL, italics: ALL, copyright: 'Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces)', reserved: [] },
  // "Source": its @fontsource LICENSE line 1 and its name table ("…Adobe Systems Incorporated…, with
  // Reserved Font Name 'Source'"), and Google Fonts' ofl/dmserifdisplay/OFL.txt.
  { family: 'DM Serif Display', slug: 'dm-serif-display', generic: 'serif', weights: [400], italics: [400], copyright: 'Copyright 2014 - 2017 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name \'Source\'. Copyright 2019 Google LLC.', reserved: ['Source'] },
  // googlefonts/caveat OFL.txt names none. Its category is handwriting: CSS's cursive.
  { family: 'Caveat', slug: 'caveat', generic: 'cursive', weights: [400, 500, 600, 700], italics: [], copyright: 'Copyright 2014 The Caveat Project Authors (https://github.com/googlefonts/caveat)', reserved: [] },
  // JetBrains/JetBrainsMono OFL.txt names none.
  { family: 'JetBrains Mono', slug: 'jetbrains-mono', generic: 'monospace', weights: upTo(800), italics: upTo(800), copyright: 'Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)', reserved: [] },
];

/** The Text tool's two choices for new text (Mark, 2026-10-01), by family; the first is the default. */
export const TEXT_DEFAULTS: readonly string[] = ['Archivo', 'Inter'];

/** The latin subset's unicode-range, from the packages' own CSS (400.css, its latin block). */
export const LATIN_RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

/** A catalogue family by name, compared as CSS compares family names (case-insensitively). */
export const catalogueFamily = (family: string): CatalogueFamily | undefined => CATALOGUE.find((f) => f.family.toLowerCase() === family.trim().toLowerCase());

/** A face's file name in its package's files/: <slug>-latin-<weight>-<normal|italic>.woff2. */
export const faceFile = (slug: string, weight: number, style: 'normal' | 'italic'): string => `${slug}-latin-${weight}-${style}.woff2`;

/** Whether the family has a face at exactly this weight and style. */
export const hasFace = (f: CatalogueFamily, weight: number, style: 'normal' | 'italic'): boolean => (style === 'italic' ? f.italics : f.weights).includes(weight);

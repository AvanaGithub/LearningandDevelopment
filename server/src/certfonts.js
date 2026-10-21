const path = require('path');
const fs = require('fs');

// Fonts available to certificate text fields. The three PDF base fonts need
// no files; the others are open-licence (OFL) Fontsource packages whose
// WOFF files pdfkit embeds and the editor loads for its live preview.
// A missing bold/italic variant falls back to the nearest one.
const FONTS = {
  helvetica: { label: 'Helvetica (sans)', css: 'Helvetica, Arial, sans-serif',
    base: { '400-normal': 'Helvetica', '700-normal': 'Helvetica-Bold', '400-italic': 'Helvetica-Oblique', '700-italic': 'Helvetica-BoldOblique' } },
  times: { label: 'Times (serif)', css: '"Times New Roman", Times, serif',
    base: { '400-normal': 'Times-Roman', '700-normal': 'Times-Bold', '400-italic': 'Times-Italic', '700-italic': 'Times-BoldItalic' } },
  courier: { label: 'Courier (typewriter)', css: '"Courier New", Courier, monospace',
    base: { '400-normal': 'Courier', '700-normal': 'Courier-Bold', '400-italic': 'Courier-Oblique', '700-italic': 'Courier-BoldOblique' } },
  cormorant: { label: 'Cormorant Garamond (elegant serif)', pkg: 'cormorant-garamond' },
  jost: { label: 'Jost (clean sans)', pkg: 'jost' },
  playfair: { label: 'Playfair Display (display serif)', pkg: 'playfair-display' },
  ebgaramond: { label: 'EB Garamond (classic serif)', pkg: 'eb-garamond' },
  cinzel: { label: 'Cinzel (classical capitals)', pkg: 'cinzel' },
  montserrat: { label: 'Montserrat (modern sans)', pkg: 'montserrat' },
  lato: { label: 'Lato (friendly sans)', pkg: 'lato' },
  greatvibes: { label: 'Great Vibes (script)', pkg: 'great-vibes' },
  dancing: { label: 'Dancing Script (handwriting)', pkg: 'dancing-script' },
};

function pkgFile(pkg, variant) {
  try {
    const dir = path.join(path.dirname(require.resolve(`@fontsource/${pkg}/package.json`)), 'files');
    const p = path.join(dir, `${pkg}-latin-${variant}.woff`);
    return fs.existsSync(p) ? p : null;
  } catch { return null; }
}

// Requested variant first, then progressively plainer ones.
const ORDER = (v) => ({
  '700-italic': ['700-italic', '700-normal', '400-italic', '400-normal'],
  '700-normal': ['700-normal', '400-normal'],
  '400-italic': ['400-italic', '400-normal'],
  '400-normal': ['400-normal'],
}[v]);

const variantOf = (bold, italic) => `${bold ? 700 : 400}-${italic ? 'italic' : 'normal'}`;

// -> pdfkit font name (base font) or a file path; Helvetica if unknown.
function resolveFont(key, bold, italic) {
  const f = FONTS[key] || FONTS.helvetica;
  for (const v of ORDER(variantOf(bold, italic))) {
    if (f.base && f.base[v]) return f.base[v];
    if (f.pkg) { const p = pkgFile(f.pkg, v); if (p) return p; }
  }
  return 'Helvetica';
}

// For the editor: which fonts exist and which file variants they have.
function fontList() {
  return Object.entries(FONTS).map(([key, f]) => ({
    key, label: f.label, css: f.css || null,
    variants: f.pkg ? ['400-normal', '700-normal', '400-italic', '700-italic'].filter((v) => pkgFile(f.pkg, v)) : [],
  }));
}

module.exports = { FONTS, resolveFont, fontList, pkgFile };

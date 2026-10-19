const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

// Personalised certificate PDFs (A4 landscape). A template is a background
// image (uploaded on the Certificates tab) plus a layout: vertical
// positions (as % of page height), font sizes and colours for the three
// text lines. Without a background image a clean built-in design is drawn.

const DEFAULT_LAYOUT = {
  name_y: 46, name_size: 34, name_color: '#1f2937',
  title_y: 60, title_size: 17, title_color: '#374151',
  dates_y: 68, dates_size: 12, dates_color: '#6b7280',
  show_cert_no: true,
};

// A4 landscape in points.
const W = 841.89, H = 595.28;

function generateCertPdf({ bgPath, layout, name, training, dates, certNo }) {
  const L = { ...DEFAULT_LAYOUT, ...(layout || {}) };
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [W, H], margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (bgPath && fs.existsSync(bgPath)) {
      try { doc.image(bgPath, 0, 0, { width: W, height: H }); }
      catch (e) { drawDefaultBackground(doc); }
    } else {
      drawDefaultBackground(doc);
    }

    const centred = (text, yPct, size, color, font) => {
      doc.font(font || 'Helvetica').fontSize(size).fillColor(color);
      doc.text(text, 40, (Number(yPct) / 100) * H - size / 2, { width: W - 80, align: 'center' });
    };

    centred(name, L.name_y, Number(L.name_size) || 34, L.name_color, 'Helvetica-Bold');
    centred(training, L.title_y, Number(L.title_size) || 17, L.title_color, 'Helvetica');
    if (dates) centred(dates, L.dates_y, Number(L.dates_size) || 12, L.dates_color, 'Helvetica');
    if (L.show_cert_no !== false && certNo) {
      doc.font('Helvetica').fontSize(8).fillColor('#9ca3af');
      doc.text('Certificate no: ' + certNo, 40, H - 30, { width: W - 80, align: 'right' });
    }
    doc.end();
  });
}

function drawDefaultBackground(doc) {
  doc.rect(0, 0, W, H).fill('#fdfbf7');
  doc.lineWidth(3).strokeColor('#C8930A').rect(24, 24, W - 48, H - 48).stroke();
  doc.lineWidth(1).strokeColor('#e3d5b8').rect(32, 32, W - 64, H - 64).stroke();
  doc.font('Helvetica').fontSize(13).fillColor('#8a7a5c')
    .text('AVANA ACADEMY · LEARNING & DEVELOPMENT', 40, 92, { width: W - 80, align: 'center', characterSpacing: 2 });
  doc.font('Helvetica-Bold').fontSize(32).fillColor('#C8930A')
    .text('Certificate of Completion', 40, 130, { width: W - 80, align: 'center' });
  doc.font('Helvetica').fontSize(13).fillColor('#6b7280')
    .text('This certificate is proudly presented to', 40, 205, { width: W - 80, align: 'center' });
  doc.fontSize(12).fillColor('#374151')
    .text('for successfully completing the training programme', 40, 310, { width: W - 80, align: 'center' });
  doc.fontSize(11).fillColor('#8a7a5c')
    .text('Avana Group · academy.avanasurgical.com', 40, H - 72, { width: W - 80, align: 'center' });
}

module.exports = { generateCertPdf, DEFAULT_LAYOUT };

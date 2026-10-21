const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const sizeOf = require('image-size');

// Personalised certificate PDFs (A4 landscape).
//
// A template is a background image plus a LAYOUT. Two layout shapes exist:
//  - fields mode (current): layout.fields = [{key, x, y, size, color, bold,
//    align, w, value, type}] — positions are % of the page, placed visually
//    in the template editor. Known keys get live values (name, training,
//    dates, desc, issue_date, signatory, cert_no); type:'qr' embeds the
//    scan-to-verify QR; anything else is a custom field whose text comes
//    from the generation form (falling back to the field's default value).
//  - legacy mode: {name_y, name_size, ...} from the first version — still
//    rendered so earlier templates keep working.

const DEFAULT_LAYOUT = {
  name_y: 46, name_size: 34, name_color: '#1f2937',
  title_y: 60, title_size: 17, title_color: '#374151',
  dates_y: 68, dates_size: 12, dates_color: '#6b7280',
  show_cert_no: true,
};

// Starting positions for a fresh template — the editor lets the admin drag
// each one onto the right spot of their design.
const DEFAULT_FIELDS = [
  { key: 'name', label: 'Participant name', x: 50, y: 42, size: 32, color: '#1f2937', bold: true, align: 'center', w: 80 },
  { key: 'desc', label: 'Description', x: 50, y: 54, size: 13, color: '#374151', align: 'center', w: 74,
    value: 'for active participation in the training programme' },
  { key: 'training', label: 'Training name', x: 50, y: 64, size: 16, color: '#1f2937', bold: true, align: 'center', w: 80 },
  { key: 'dates', label: 'Dates & location', x: 50, y: 71, size: 11, color: '#6b7280', align: 'center', w: 80 },
  { key: 'issue_date', label: 'Date of issue', x: 18, y: 88, size: 11, color: '#374151', align: 'center', w: 28 },
  { key: 'signatory', label: 'Authorised signatory', type: 'img', x: 82, y: 86, w: 18 },
  { key: 'qr', label: 'Scan-to-verify QR', type: 'qr', x: 91, y: 15, qsize: 9 },
  { key: 'cert_no', label: 'Certificate number', x: 50, y: 96, size: 8, color: '#9ca3af', align: 'center', w: 60 },
];

// The page takes the uploaded design's proportions (longest side scaled
// to the A4 base length); A4 landscape when there is no design.
const BASE = 841.89;
function pageDims(bgDims) {
  const w = Number(bgDims?.w), h = Number(bgDims?.h);
  if (w > 0 && h > 0) {
    return w >= h ? { W: BASE, H: (h / w) * BASE } : { H: BASE, W: (w / h) * BASE };
  }
  return { W: 841.89, H: 595.28 };
}

// Image fields (signature etc.) live in the same uploads store.
const FILES_DIR = path.join(__dirname, '..', 'uploads');

// values: {name, training, dates, desc, issue_date, cert_no, <custom
// keys>}; verifyUrl feeds the QR; bgDims {w,h} sets the page proportions.
function generateCertPdf({ bgPath, bgDims, layout, values, verifyUrl, name, training, dates, certNo }) {
  const vals = values || { name, training, dates, cert_no: certNo };
  const { W, H } = pageDims(bgDims);
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: [W, H], margin: 0 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const fields = Array.isArray(layout?.fields) ? layout.fields : null;
      if (bgPath && fs.existsSync(bgPath)) {
        try { doc.image(bgPath, 0, 0, { width: W, height: H }); }
        catch (e) { drawDefaultBackground(doc, !fields, W, H); }
      } else {
        drawDefaultBackground(doc, !fields, W, H);
      }
      if (fields) {
        for (const f of fields) {
          if (f.hidden) continue;
          if (f.type === 'qr') {
            if (!verifyUrl) continue;
            const q = ((Number(f.qsize) || 9) / 100) * W;
            const png = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 512 });
            doc.image(png, (Number(f.x) / 100) * W - q / 2, (Number(f.y) / 100) * H - q / 2, { width: q, height: q });
            continue;
          }
          // Image field (signature etc.): drawn centred on its position,
          // width as % of the page, aspect preserved.
          if (f.type === 'img') {
            if (!f.file_id) continue;
            const fp = path.join(FILES_DIR, String(f.file_id).replace(/[^\w.-]/g, ''));
            if (!fs.existsSync(fp)) continue;
            let dim;
            try { dim = sizeOf(fs.readFileSync(fp)); } catch { continue; }
            if (!dim?.width || !dim?.height) continue;
            const drawW = ((Number(f.w) || 18) / 100) * W;
            const drawH = drawW * (dim.height / dim.width);
            try { doc.image(fp, (Number(f.x) / 100) * W - drawW / 2, (Number(f.y) / 100) * H - drawH / 2, { width: drawW }); }
            catch (e) { /* unreadable image — skip rather than fail the batch */ }
            continue;
          }
          const text = String(vals[f.key] ?? f.value ?? '').trim();
          if (!text) continue;
          const size = Number(f.size) || 12;
          const wPct = Number(f.w) || 60;
          const boxW = (wPct / 100) * W;
          const align = f.align === 'left' ? 'left' : f.align === 'right' ? 'right' : 'center';
          const x = align === 'center' ? (Number(f.x) / 100) * W - boxW / 2
            : align === 'left' ? (Number(f.x) / 100) * W
            : (Number(f.x) / 100) * W - boxW;
          doc.font(f.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(f.color || '#333333');
          doc.text(text, x, (Number(f.y) / 100) * H - size / 2, { width: boxW, align });
        }
        doc.end();
        return;
      }

      // Legacy layout.
      const L = { ...DEFAULT_LAYOUT, ...(layout || {}) };
      const centred = (text, yPct, size, color, font) => {
        doc.font(font || 'Helvetica').fontSize(size).fillColor(color);
        doc.text(text, 40, (Number(yPct) / 100) * H - size / 2, { width: W - 80, align: 'center' });
      };
      if (vals.name) centred(vals.name, L.name_y, Number(L.name_size) || 34, L.name_color, 'Helvetica-Bold');
      if (vals.training) centred(vals.training, L.title_y, Number(L.title_size) || 17, L.title_color, 'Helvetica');
      if (vals.dates) centred(vals.dates, L.dates_y, Number(L.dates_size) || 12, L.dates_color, 'Helvetica');
      if (L.show_cert_no !== false && vals.cert_no) {
        doc.font('Helvetica').fontSize(8).fillColor('#9ca3af');
        doc.text('Certificate no: ' + vals.cert_no, 40, H - 30, { width: W - 80, align: 'right' });
      }
      doc.end();
    } catch (e) { reject(e); }
  });
}

function drawDefaultBackground(doc, legacyWording, W = 841.89, H = 595.28) {
  doc.rect(0, 0, W, H).fill('#fdfbf7');
  doc.lineWidth(3).strokeColor('#C8930A').rect(24, 24, W - 48, H - 48).stroke();
  doc.lineWidth(1).strokeColor('#e3d5b8').rect(32, 32, W - 64, H - 64).stroke();
  doc.font('Helvetica').fontSize(13).fillColor('#8a7a5c')
    .text('AVANA ACADEMY · LEARNING & DEVELOPMENT', 40, 92, { width: W - 80, align: 'center', characterSpacing: 2 });
  doc.font('Helvetica-Bold').fontSize(32).fillColor('#C8930A')
    .text('Certificate of Completion', 40, 130, { width: W - 80, align: 'center' });
  doc.font('Helvetica').fontSize(13).fillColor('#6b7280')
    .text('This certificate is proudly presented to', 40, 205, { width: W - 80, align: 'center' });
  if (legacyWording) {
    doc.fontSize(12).fillColor('#374151')
      .text('for successfully completing the training programme', 40, 310, { width: W - 80, align: 'center' });
  }
  doc.fontSize(11).fillColor('#8a7a5c')
    .text('Avana Group · academy.avanasurgical.com', 40, H - 72, { width: W - 80, align: 'center' });
}

module.exports = { generateCertPdf, DEFAULT_LAYOUT, DEFAULT_FIELDS };

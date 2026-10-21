import React, { useEffect, useRef, useState } from 'react';
import { api, apiUpload } from '../api.js';
import { useToast } from '../App.jsx';

// Visual certificate template editor. The uploaded design is shown at its
// own proportions; every field is a box the admin drags into place, with
// snap guides to the page centre and to the other fields. Text boxes render
// in the chosen font exactly as the PDF will (wrapping / auto-shrink).

// Filled automatically at generation time; all other text fields take
// their text from the template default and/or the generation form.
export const AUTO_KEYS = ['name', 'training', 'dates', 'issue_date', 'cert_no'];
// Multi-line fields wrap inside their box; one-line fields auto-shrink.
// Templates saved before the option existed: only the description wraps.
export const isMulti = (f) => (f.multiline === undefined ? f.key === 'desc' : Boolean(f.multiline));
const isText = (f) => !f.type || f.type === 'text';

const SAMPLE = {
  name: 'Participant Name', training: 'Training Name — Batch 1',
  dates: '01 Jan 2026 - 03 Jan 2026 · Chennai', issue_date: '21 Oct 2026',
  cert_no: 'AVA-2026-TRG-101-A0042',
};
const SNAP = 0.8;          // % of the page within which a guide catches

const defaultFields = () => ([
  { key: 'name', label: 'Participant name', x: 50, y: 42, size: 32, color: '#1f2937', bold: true, align: 'center', w: 80 },
  { key: 'desc', label: 'Description', x: 50, y: 54, size: 13, color: '#374151', align: 'center', w: 74,
    multiline: true, lh: 1.5, value: 'for active participation in the training programme' },
  { key: 'training', label: 'Training name', x: 50, y: 64, size: 16, color: '#1f2937', bold: true, align: 'center', w: 80 },
  { key: 'dates', label: 'Dates & location', x: 50, y: 71, size: 11, color: '#6b7280', align: 'center', w: 80 },
  { key: 'issue_date', label: 'Date of issue', x: 18, y: 88, size: 11, color: '#374151', align: 'center', w: 28 },
  { key: 'signatory', label: 'Authorised signatory', type: 'img', x: 82, y: 86, w: 18 },
  { key: 'qr', label: 'Scan-to-verify QR', type: 'qr', x: 91, y: 15, qsize: 9 },
  { key: 'cert_no', label: 'Certificate number', x: 50, y: 96, size: 8, color: '#9ca3af', align: 'center', w: 60 },
]);
// Legacy {name_y...} layouts are upgraded to the fields editor on open.
const toFields = (layout) => {
  if (Array.isArray(layout?.fields) && layout.fields.length) return JSON.parse(JSON.stringify(layout.fields));
  const f = defaultFields();
  const L = layout || {};
  const set = (key, y, size, color) => {
    const x = f.find((q) => q.key === key);
    if (!x) return;
    if (L[y] !== undefined) x.y = Number(L[y]);
    if (L[size] !== undefined) x.size = Number(L[size]);
    if (L[color] !== undefined) x.color = L[color];
  };
  set('name', 'name_y', 'name_size', 'name_color');
  set('training', 'title_y', 'title_size', 'title_color');
  set('dates', 'dates_y', 'dates_size', 'dates_color');
  return f;
};

// ---- geometry --------------------------------------------------------------
const widthPct = (q) => (q.type === 'qr' ? (q.qsize || 9) : q.type === 'cover' ? (q.w || 20)
  : q.type === 'img' ? (q.w || 18) : (q.w || 60));
// Horizontal extent in % of the page. Text boxes anchor by alignment
// (x = left edge / centre / right edge); everything else by its centre.
const boxX = (q) => {
  const w = widthPct(q);
  const l = isText(q)
    ? (q.align === 'left' ? q.x : q.align === 'right' ? q.x - w : q.x - w / 2)
    : q.x - w / 2;
  return { l, c: l + w / 2, r: l + w, w };
};
// x that puts the box's left edge at l, for the field's anchoring.
const xForLeft = (q, l) => {
  const w = widthPct(q);
  if (!isText(q)) return l + w / 2;
  return q.align === 'left' ? l : q.align === 'right' ? l + w : l + w / 2;
};

// ---- fonts -----------------------------------------------------------------
const loadedFaces = new Set();
const familyOf = (key, fonts) => {
  const m = fonts.find((x) => x.key === key);
  if (!m || m.key === 'helvetica') return 'Helvetica, Arial, sans-serif';
  return m.css || `"cert-${m.key}", serif`;
};
function loadFontFaces(meta) {
  const jobs = [];
  for (const v of meta.variants || []) {
    const id = meta.key + '/' + v;
    if (loadedFaces.has(id)) continue;
    loadedFaces.add(id);
    const [weight, style] = v.split('-');
    const face = new FontFace(`cert-${meta.key}`, `url(/api/certs/fonts/${meta.key}/${v})`, { weight, style });
    jobs.push(face.load().then((f) => { document.fonts.add(f); }).catch(() => {}));
  }
  return Promise.all(jobs);
}
const measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

// ---- small UI bits ---------------------------------------------------------
const Toggle = ({ on, onClick, title, children, style }) => (
  <button type="button" className="btn" title={title} onClick={onClick}
    style={{ minWidth: 30, padding: '3px 8px', ...(on ? { background: '#C8930A', color: '#fff', borderColor: '#C8930A' } : {}), ...style }}>
    {children}
  </button>
);
const Num = ({ label, value, onChange, min, max, step = 1, width = 58, title }) => (
  <label className="muted mini" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} title={title}>
    {label}
    <input type="number" min={min} max={max} step={step} style={{ width }} value={value}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
  </label>
);

export default function CertEditor({ tpl, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(tpl.name);
  const [fields, setFields] = useState(() => toFields(tpl.layout));
  const [bgId, setBgId] = useState(tpl.bg_file_id);
  const [dims, setDims] = useState({ w: tpl.bg_w, h: tpl.bg_h });
  const [sel, setSel] = useState(0);
  const [err, setErr] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [guides, setGuides] = useState({ x: null, y: null });
  const [fonts, setFonts] = useState([]);
  const [, setFontTick] = useState(0);
  const [canvasPx, setCanvasPx] = useState(820);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  // The page takes the design's own proportions (A4 landscape fallback);
  // pageW/pageH are the PDF page size in points.
  const hasDims = dims?.w > 0 && dims?.h > 0;
  const ratio = hasDims ? `${dims.w} / ${dims.h}` : '841.89 / 595.28';
  const pageW = hasDims ? (dims.w >= dims.h ? 841.89 : 841.89 * (dims.w / dims.h)) : 841.89;
  const scale = canvasPx / pageW;      // canvas px per PDF point

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanvasPx(el.getBoundingClientRect().width || 820));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Font list + every face, so the picker and the boxes show real fonts.
  useEffect(() => {
    api.get('/api/certs/fonts').then((list) => {
      setFonts(list);
      Promise.all(list.map(loadFontFaces)).then(() => setFontTick((n) => n + 1));
    }).catch(() => {});
  }, []);

  const upd = (i, patch) => {
    setDirty(true);
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  };

  // ---- design colour sampling (for Hide areas) ----
  const pixRef = useRef(null);
  useEffect(() => {
    pixRef.current = null;
    if (!bgId) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      pixRef.current = { ctx, w: c.width, h: c.height };
    };
    img.src = '/api/files/' + bgId;
  }, [bgId]);
  // Average of four points just outside the box's edges.
  const sampleAround = (q) => {
    const p = pixRef.current;
    if (!p) return null;
    const pts = [
      [q.x - q.w / 2 - 0.8, q.y], [q.x + q.w / 2 + 0.8, q.y],
      [q.x, q.y - q.h / 2 - 0.6], [q.x, q.y + q.h / 2 + 0.6],
    ];
    let r = 0, g = 0, b = 0, n = 0;
    for (const [xp, yp] of pts) {
      const px = Math.round((Math.min(99.5, Math.max(0.5, xp)) / 100) * (p.w - 1));
      const py = Math.round((Math.min(99.5, Math.max(0.5, yp)) / 100) * (p.h - 1));
      const d = p.ctx.getImageData(px, py, 1, 1).data;
      r += d[0]; g += d[1]; b += d[2]; n++;
    }
    const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
    return '#' + hex(r) + hex(g) + hex(b);
  };
  const matchColour = (i, q = fields[i]) => {
    const c = q && sampleAround(q);
    if (c) upd(i, { color: c });
  };

  // ---- dragging with smart guides ----
  const pctFromEvent = (ev) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * 100, y: ((ev.clientY - r.top) / r.height) * 100 };
  };
  const startDrag = (ev, i) => {
    ev.preventDefault();
    setSel(i);
    const p = pctFromEvent(ev);
    dragRef.current = { i, dx: p.x - fields[i].x, dy: p.y - fields[i].y };
  };
  // Snap the dragged box's left/centre/right edge to the page centre or to
  // any other field's left/centre/right edge, and its row to theirs.
  const snap = (i, nx, ny) => {
    const me = fields[i];
    const others = fields.filter((q, j) => j !== i && !q.hidden);
    let bestX = null; let gx = null;
    const mine = boxX({ ...me, x: nx });
    const tryX = (target, keys) => {
      for (const k of keys) {
        const d = target - mine[k];
        if (Math.abs(d) <= SNAP && (bestX === null || Math.abs(d) < Math.abs(bestX))) { bestX = d; gx = target; }
      }
    };
    tryX(50, ['c']);
    for (const o of others) { const b = boxX(o); tryX(b.l, ['l', 'c', 'r']); tryX(b.c, ['l', 'c', 'r']); tryX(b.r, ['l', 'c', 'r']); }
    let bestY = null; let gy = null;
    for (const t of [50, ...others.map((o) => o.y)]) {
      const d = t - ny;
      if (Math.abs(d) <= SNAP && (bestY === null || Math.abs(d) < Math.abs(bestY))) { bestY = d; gy = t; }
    }
    return { x: nx + (bestX || 0), y: ny + (bestY || 0), gx, gy };
  };
  const onMove = (ev) => {
    const d = dragRef.current;
    if (!d) return;
    ev.preventDefault();
    const p = pctFromEvent(ev);
    let nx = p.x - d.dx; let ny = p.y - d.dy;
    let gx = null; let gy = null;
    if (!ev.altKey) ({ x: nx, y: ny, gx, gy } = snap(d.i, nx, ny));
    const r1 = (v) => Math.round(Math.min(99, Math.max(1, v)) * 10) / 10;
    upd(d.i, { x: r1(nx), y: r1(ny) });
    setGuides({ x: gx, y: gy });
  };
  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setGuides({ x: null, y: null });
    if (d && fields[d.i]?.type === 'cover' && !fields[d.i].manual_color) matchColour(d.i);
  };

  // Arrow keys nudge the selected box (Shift = bigger steps).
  useEffect(() => {
    const onKey = (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const q = fields[sel];
      if (!q) return;
      e.preventDefault();
      const step = e.shiftKey ? 1 : 0.2;
      const r1 = (v) => Math.round(Math.min(99, Math.max(1, v)) * 10) / 10;
      if (e.key === 'ArrowLeft') upd(sel, { x: r1(q.x - step) });
      if (e.key === 'ArrowRight') upd(sel, { x: r1(q.x + step) });
      if (e.key === 'ArrowUp') upd(sel, { y: r1(q.y - step) });
      if (e.key === 'ArrowDown') upd(sel, { y: r1(q.y + step) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- alignment helpers ----
  // Changing alignment keeps the box where it is; only the text inside moves.
  const setAlign = (i, align) => {
    const q = fields[i];
    const { l } = boxX(q);
    upd(i, { align, x: Math.round(xForLeft({ ...q, align }, l) * 10) / 10 });
  };
  const centreOnPage = (i) => {
    const q = fields[i];
    upd(i, { x: Math.round(xForLeft(q, 50 - widthPct(q) / 2) * 10) / 10 });
  };
  // Width changes keep the box centred where it was.
  const setWidth = (i, w) => {
    const q = fields[i];
    if (w === '') { upd(i, { w }); return; }
    const c = boxX(q).c;
    const nq = { ...q, w };
    upd(i, { w, x: Math.round(xForLeft(nq, c - widthPct(nq) / 2) * 10) / 10 });
  };

  // ---- text sizing exactly like the PDF: one-line fields shrink to fit ----
  const effSize = (q, text) => {
    const size = Number(q.size) || 12;
    if (isMulti(q) || !measureCtx) return size;
    measureCtx.font = `${q.italic ? 'italic ' : ''}${q.bold ? 700 : 400} ${size}px ${familyOf(q.font, fonts)}`;
    const t = q.upper ? text.toUpperCase() : text;
    const tw = measureCtx.measureText(t).width + size * ((Number(q.spacing) || 0) / 100) * Math.max(0, t.length - 1);
    const boxW = (widthPct(q) / 100) * pageW;
    return tw > boxW ? Math.max(5, size * (boxW / tw) * 0.99) : size;
  };

  // ---- save / preview / close ----
  const persist = () => api.patch('/api/certs/templates/' + tpl.id, { name: name.trim() || tpl.name, layout: { fields } })
    .then(() => setDirty(false));
  const save = async () => {
    try { await persist(); toast('Template saved.'); onSaved(); } catch (e) { setErr(e.message); }
  };
  // Save first so the preview never shows a stale layout; the tab opens
  // synchronously so popup blockers allow it.
  const preview = async () => {
    const w = window.open('about:blank', '_blank');
    try {
      await persist();
      if (w) w.location.href = `/api/certs/templates/${tpl.id}/preview?t=${Date.now()}`;
    } catch (e) { if (w) w.close(); setErr(e.message); }
  };
  const close = () => {
    if (dirty && !confirm('You have unsaved changes on this template. Close without saving?')) return;
    onClose();
  };

  const addCustom = () => {
    const label = prompt('Name of the new field (e.g. Trainer name, Grade):');
    if (!label?.trim()) return;
    const key = 'custom_' + Date.now().toString(36);
    setDirty(true);
    setFields((fs) => [...fs, { key, label: label.trim(), x: 50, y: 80, size: 12, color: '#374151', align: 'center', w: 40, value: '' }]);
    setSel(fields.length);
  };
  // A box painted in the design's own colour, to blank out placeholder text
  // that is part of the design image (e.g. "[Signature]").
  const addCover = () => {
    const key = 'cover_' + Date.now().toString(36);
    const q = { key, label: 'Hidden area', type: 'cover', x: 50, y: 50, w: 20, h: 4, color: '#ffffff' };
    q.color = sampleAround(q) || q.color;
    setDirty(true);
    setFields((fs) => [...fs, q]);
    setSel(fields.length);
  };

  const f = fields[sel];
  const chipText = (q) => SAMPLE[q.key] || q.value || q.label;

  // ---- rendering ----
  const chip = (q, i) => {
    const selected = sel === i;
    const base = {
      position: 'absolute', top: q.y + '%', cursor: 'move', boxSizing: 'border-box',
      zIndex: q.type === 'cover' ? 1 : selected ? 3 : 2,
      outline: selected ? '2px solid #C8930A' : '1px dashed rgba(200,147,10,.55)',
    };
    if (q.type === 'cover') {
      return { ...base, left: q.x + '%', transform: 'translate(-50%, -50%)', width: (q.w || 20) + '%', height: (q.h || 4) + '%',
        background: q.color || '#fff', outline: selected ? '2px solid #C8930A' : '1px dotted rgba(120,120,120,.6)' };
    }
    if (q.type === 'qr') {
      return { ...base, left: q.x + '%', transform: 'translate(-50%, -50%)', width: (q.qsize || 9) + '%', aspectRatio: '1',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#555',
        background: 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 10px 10px' };
    }
    if (q.type === 'img') {
      return { ...base, left: q.x + '%', transform: 'translate(-50%, -50%)', width: (q.w || 18) + '%', minHeight: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#777',
        background: selected ? 'rgba(200,147,10,.10)' : 'transparent' };
    }
    const text = chipText(q);
    const multi = isMulti(q);
    return {
      ...base, left: boxX(q).l + '%', width: widthPct(q) + '%', transform: 'translateY(-50%)',
      background: selected ? 'rgba(200,147,10,.10)' : 'transparent',
      fontFamily: familyOf(q.font, fonts), fontSize: effSize(q, text) * scale,
      fontWeight: q.bold ? 700 : 400, fontStyle: q.italic ? 'italic' : 'normal',
      textTransform: q.upper ? 'uppercase' : 'none', letterSpacing: ((Number(q.spacing) || 0) / 100) + 'em',
      lineHeight: multi ? (Number(q.lh) || 1.2) : 1.2, color: q.color || '#333',
      textAlign: q.align || 'center', whiteSpace: multi ? 'pre-wrap' : 'nowrap', overflow: 'visible',
    };
  };

  const textControls = (q, i) => (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={q.font || 'helvetica'} onChange={(e) => upd(i, { font: e.target.value })}
          style={{ fontSize: 13, fontFamily: familyOf(q.font, fonts), maxWidth: 260 }} title="Font">
          {(fonts.length ? fonts : [{ key: 'helvetica', label: 'Helvetica (sans)' }]).map((m) => (
            <option key={m.key} value={m.key} style={{ fontFamily: familyOf(m.key, fonts) }}>{m.label}</option>
          ))}
        </select>
        <Num label="size" value={q.size} min={5} max={120} onChange={(v) => upd(i, { size: v })} />
        <input type="color" value={q.color || '#333333'} title="Colour" onChange={(e) => upd(i, { color: e.target.value })} />
        <Toggle on={q.bold} title="Bold" onClick={() => upd(i, { bold: !q.bold })}><b>B</b></Toggle>
        <Toggle on={q.italic} title="Italic" onClick={() => upd(i, { italic: !q.italic })}><i>I</i></Toggle>
        <Toggle on={q.upper} title="UPPERCASE" onClick={() => upd(i, { upper: !q.upper })}>AA</Toggle>
        <Num label="letter spacing %" value={q.spacing ?? 0} min={0} max={80} width={52}
          title="Space between letters, as % of the font size" onChange={(v) => upd(i, { spacing: v })} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <span className="muted mini">align</span>
        <Toggle on={(q.align || 'center') === 'left'} title="Align left" onClick={() => setAlign(i, 'left')}>⇤</Toggle>
        <Toggle on={(q.align || 'center') === 'center'} title="Centre" onClick={() => setAlign(i, 'center')}>↔</Toggle>
        <Toggle on={(q.align || 'center') === 'right'} title="Align right" onClick={() => setAlign(i, 'right')}>⇥</Toggle>
        <Num label="box width %" value={q.w ?? 60} min={5} max={98} width={52} onChange={(v) => setWidth(i, v)} />
        <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}
          title="On: wraps inside the box and keeps line breaks you type. Off: stays on one line and shrinks to fit.">
          <input type="checkbox" checked={isMulti(q)} onChange={(e) => upd(i, { multiline: e.target.checked })} />
          Multi-line
        </label>
        {isMulti(q)
          ? <Num label="line spacing" value={q.lh ?? 1.2} min={0.8} max={3} step={0.1} width={52} onChange={(v) => upd(i, { lh: v })} />
          : <span className="muted mini">one line — shrinks automatically if the text is too long</span>}
      </div>
      {!AUTO_KEYS.includes(q.key) && (
        isMulti(q)
          ? <textarea rows={3} style={{ width: '100%', marginTop: 8, fontFamily: 'inherit', fontSize: 13 }} value={q.value || ''}
              placeholder={q.key === 'desc' ? 'Default description — press Enter for a new line (editable while generating)' : 'Default text (editable while generating)'}
              onChange={(e) => upd(i, { value: e.target.value })} />
          : <input style={{ width: '100%', marginTop: 8 }} value={q.value || ''}
              placeholder="Default text (editable while generating)"
              onChange={(e) => upd(i, { value: e.target.value })} />
      )}
    </>
  );

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 940, width: '96vw' }}>
        <h3 style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          🖼 <input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} style={{ fontSize: 15, fontWeight: 600, flex: 1 }} />
          {dirty && <span className="pill warn mini">unsaved</span>}
        </h3>
        <p className="muted mini" style={{ margin: '4px 0 8px' }}>
          <b>Drag each box</b> onto your design — pink guides appear and it <b>snaps</b> to the page centre
          and to other fields' edges (hold <b>Alt</b> to place freely; <b>arrow keys</b> nudge, Shift for
          bigger steps). Boxes show the real font and wrapping. If the design already has sample text
          printed in it (a name, "[Signature]"…), cover it with <b>+ Hide area</b>.
        </p>
        <div ref={canvasRef}
          onMouseMove={onMove} onMouseUp={endDrag} onMouseLeave={endDrag}
          style={{
            position: 'relative', width: '100%', aspectRatio: ratio,
            background: bgId ? `url(/api/files/${bgId}) center / 100% 100% no-repeat` : '#fdfbf7',
            border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden', userSelect: 'none', touchAction: 'none',
          }}>
          {fields.map((q, i) => q.hidden ? null : (
            <div key={q.key} onMouseDown={(e) => startDrag(e, i)} style={chip(q, i)}>
              {q.type === 'qr' ? 'QR'
                : q.type === 'cover' ? null
                : q.type === 'img'
                  ? (q.file_id
                    ? <img src={'/api/files/' + q.file_id} alt="" draggable={false}
                        style={{ width: '100%', display: 'block', pointerEvents: 'none' }} />
                    : '✍ ' + q.label)
                  : chipText(q)}
            </div>
          ))}
          {guides.x !== null && <div style={{ position: 'absolute', top: 0, bottom: 0, left: guides.x + '%', width: 1, background: '#e0389b', zIndex: 5, pointerEvents: 'none' }} />}
          {guides.y !== null && <div style={{ position: 'absolute', left: 0, right: 0, top: guides.y + '%', height: 1, background: '#e0389b', zIndex: 5, pointerEvents: 'none' }} />}
        </div>

        {f && (
          <div style={{ marginTop: 10, fontSize: 13, border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <b style={{ minWidth: 120 }}>
                {f.key.startsWith('custom_')
                  ? <input value={f.label} onChange={(e) => upd(sel, { label: e.target.value })} style={{ width: 150 }} />
                  : f.label}
              </b>
              {!AUTO_KEYS.includes(f.key) && f.type !== 'qr' && f.type !== 'cover' && (
                <select value={f.type === 'img' ? 'img' : 'text'} style={{ fontSize: 12 }}
                  onChange={(e) => upd(sel, e.target.value === 'img'
                    ? { type: 'img', w: f.w && f.w <= 40 ? f.w : 18 }
                    : { type: undefined, size: f.size || 12, w: f.w || 40 })}>
                  <option value="text">Text</option>
                  <option value="img">Image</option>
                </select>
              )}
              <span style={{ flex: 1 }} />
              <button className="btn" type="button" title="Centre this box horizontally on the page" onClick={() => centreOnPage(sel)}>⇔ Centre on page</button>
              <button className="btn link" title="Remove this field from the certificate"
                onClick={() => { setDirty(true); setFields((fs) => fs.filter((_, j) => j !== sel)); setSel(0); }}>✕ remove</button>
            </div>

            {f.type === 'qr' ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Num label="QR size %" value={f.qsize || 9} min={4} max={25} onChange={(v) => upd(sel, { qsize: v || 9 })} />
                <span className="muted mini">Scanning it opens the hub's verification page for that certificate.</span>
              </div>
            ) : f.type === 'cover' ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Num label="width %" value={f.w || 20} min={1} max={100} step={0.5} onChange={(v) => upd(sel, { w: v || 20 })} />
                <Num label="height %" value={f.h || 4} min={0.5} max={100} step={0.5} onChange={(v) => upd(sel, { h: v || 4 })} />
                <input type="color" value={f.color || '#ffffff'} title="Colour"
                  onChange={(e) => upd(sel, { color: e.target.value, manual_color: true })} />
                <button className="btn" type="button" title="Pick up the design's colour around this box"
                  onClick={() => { upd(sel, { manual_color: false }); matchColour(sel); }}>Match design colour</button>
                <span className="muted mini">Covers text printed in the design — size it over the text and drop it; it takes the surrounding colour.</span>
              </div>
            ) : f.type === 'img' ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Num label="width %" value={f.w || 18} min={4} max={60} onChange={(v) => upd(sel, { w: v || 18 })} />
                <label className="btn" style={{ cursor: 'pointer' }}>
                  {f.file_id ? 'Replace image…' : '⬆ Upload image…'}
                  <input type="file" accept="image/png,image/jpeg" style={{ display: 'none' }}
                    onChange={async (e) => {
                      if (!e.target.files.length) return;
                      try {
                        const [up] = await apiUpload(e.target.files);
                        upd(sel, { file_id: up.id });
                      } catch (e2) { setErr(e2.message); }
                    }} />
                </label>
                <span className="muted mini">PNG with a transparent background looks best for signatures.</span>
              </div>
            ) : textControls(f, sel)}
          </div>
        )}

        {err && <p className="err">{err}</p>}
        <div className="form-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn gold" onClick={save}>Save template</button>
          <button className="btn" onClick={addCustom}>+ Add custom field</button>
          <button className="btn" onClick={addCover}>+ Hide area</button>
          <button className="btn" onClick={preview} title="Saves, then opens the real PDF with sample data">Save &amp; preview PDF</button>
          <label className="btn" style={{ cursor: 'pointer' }}>
            Replace design…
            <input type="file" accept="image/png,image/jpeg,application/pdf" style={{ display: 'none' }}
              onChange={async (e) => {
                if (!e.target.files.length) return;
                try {
                  const [up] = await apiUpload(e.target.files);
                  const updated = await api.patch('/api/certs/templates/' + tpl.id, { bg_file_id: up.id });
                  setBgId(updated.bg_file_id);
                  setDims({ w: updated.bg_w, h: updated.bg_h });
                } catch (e2) { setErr(e2.message); }
              }} />
          </label>
          <button className="btn" onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}

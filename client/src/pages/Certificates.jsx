import React, { useEffect, useRef, useState } from 'react';
import { api, apiUpload, fmtDate, fmtRange } from '../api.js';
import { useToast } from '../App.jsx';

const ELIGIBLE_PCT = 75;

// Which field keys are filled automatically at generation time; everything
// else (description, signatory, custom fields) takes its text from the
// template default and/or the generation form.
const AUTO_KEYS = ['name', 'training', 'dates', 'issue_date', 'cert_no'];
const SAMPLE = {
  name: 'Participant Name', training: 'Training Name — Batch 1',
  dates: '01 Jan 2026 - 03 Jan 2026 · Chennai', issue_date: '21 Oct 2026',
  cert_no: 'AVA-2026-TRG-101-A0042',
};

// Legacy {name_y...} layouts are upgraded to the fields editor on open.
const defaultFields = () => ([
  { key: 'name', label: 'Participant name', x: 50, y: 42, size: 32, color: '#1f2937', bold: true, align: 'center', w: 80 },
  { key: 'desc', label: 'Description', x: 50, y: 54, size: 13, color: '#374151', align: 'center', w: 74,
    value: 'for active participation in the training programme' },
  { key: 'training', label: 'Training name', x: 50, y: 64, size: 16, color: '#1f2937', bold: true, align: 'center', w: 80 },
  { key: 'dates', label: 'Dates & location', x: 50, y: 71, size: 11, color: '#6b7280', align: 'center', w: 80 },
  { key: 'issue_date', label: 'Date of issue', x: 18, y: 88, size: 11, color: '#374151', align: 'center', w: 28 },
  { key: 'signatory', label: 'Authorised signatory', type: 'img', x: 82, y: 86, w: 18 },
  { key: 'qr', label: 'Scan-to-verify QR', type: 'qr', x: 91, y: 15, qsize: 9 },
  { key: 'cert_no', label: 'Certificate number', x: 50, y: 96, size: 8, color: '#9ca3af', align: 'center', w: 60 },
]);
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

// ---- Visual template editor ----------------------------------------------
// The uploaded design is shown at true A4-landscape proportions; every
// field is a chip the admin DRAGS into place. Clicking a chip opens its
// size/colour/width/default-text controls.
function TplEditor({ tpl, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(tpl.name);
  const [fields, setFields] = useState(() => toFields(tpl.layout));
  const [bgId, setBgId] = useState(tpl.bg_file_id);
  const [dims, setDims] = useState({ w: tpl.bg_w, h: tpl.bg_h });
  const [sel, setSel] = useState(0);
  const [err, setErr] = useState(null);
  // The page takes the design's own proportions (A4 landscape fallback).
  const ratio = dims?.w > 0 && dims?.h > 0 ? `${dims.w} / ${dims.h}` : '841.89 / 595.28';
  const pageW = dims?.w > 0 && dims?.h > 0
    ? (dims.w >= dims.h ? 841.89 : 841.89 * (dims.w / dims.h)) : 841.89;
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  const upd = (i, patch) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const posFromEvent = (ev) => {
    const r = canvasRef.current.getBoundingClientRect();
    const pct = (v) => Math.round(Math.min(98, Math.max(2, v * 100)) * 10) / 10;
    return { x: pct((ev.clientX - r.left) / r.width), y: pct((ev.clientY - r.top) / r.height) };
  };
  const onMove = (ev) => {
    if (dragRef.current === null) return;
    ev.preventDefault();
    upd(dragRef.current, posFromEvent(ev));
  };

  const save = async () => {
    try {
      await api.patch('/api/certs/templates/' + tpl.id, { name: name.trim() || tpl.name, layout: { fields } });
      toast('Template saved — open Preview to see the real PDF.');
      onSaved();
    } catch (e) { setErr(e.message); }
  };

  const addCustom = () => {
    const label = prompt('Name of the new field (e.g. Trainer signature, Grade):');
    if (!label?.trim()) return;
    const key = 'custom_' + Date.now().toString(36);
    setFields((fs) => [...fs, { key, label: label.trim(), x: 50, y: 80, size: 12, color: '#374151', align: 'center', w: 40, value: '' }]);
    setSel(fields.length);
  };

  const f = fields[sel];
  const chipText = (q) => SAMPLE[q.key] || q.value || q.label;
  // On-canvas font scale: canvas px per PDF point.
  const scale = (canvasRef.current?.getBoundingClientRect().width || 820) / pageW;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, width: '96vw' }}>
        <h3 style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          🖼 <input value={name} onChange={(e) => setName(e.target.value)} style={{ fontSize: 15, fontWeight: 600, flex: 1 }} />
        </h3>
        <p className="muted mini" style={{ margin: '4px 0 8px' }}>
          <b>Drag each box</b> onto the right spot of your design. Click a box to change its size,
          colour, width or wording below. The boxes show sample text — the real certificate prints each
          participant's own details.
        </p>
        <div ref={canvasRef}
          onMouseMove={onMove}
          onMouseUp={() => { dragRef.current = null; }}
          onMouseLeave={() => { dragRef.current = null; }}
          style={{
            position: 'relative', width: '100%', aspectRatio: ratio,
            background: bgId ? `url(/api/files/${bgId}) center / 100% 100% no-repeat` : '#fdfbf7',
            border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden', userSelect: 'none', touchAction: 'none',
          }}>
          {fields.map((q, i) => q.hidden ? null : (
            <div key={q.key}
              onMouseDown={(e) => { e.preventDefault(); dragRef.current = i; setSel(i); }}
              style={{
                position: 'absolute', left: q.x + '%', top: q.y + '%',
                transform: 'translate(-50%, -50%)', cursor: 'move',
                outline: sel === i ? '2px solid #C8930A' : '1px dashed rgba(200,147,10,.55)',
                background: sel === i ? 'rgba(200,147,10,.10)' : 'rgba(255,255,255,.08)',
                padding: '1px 4px', borderRadius: 4, whiteSpace: 'nowrap', maxWidth: '96%',
                overflow: 'hidden', textOverflow: 'ellipsis',
                ...(q.type === 'qr'
                  ? { width: (q.qsize || 9) + '%', aspectRatio: '1', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 11, color: '#555', background: 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 10px 10px' }
                  : q.type === 'img'
                  ? { width: (q.w || 18) + '%', minHeight: 24, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 11, color: '#777', padding: 0 }
                  : { fontSize: Math.max(7, (q.size || 12) * scale), color: q.color || '#333',
                      fontWeight: q.bold ? 700 : 400 }),
              }}>
              {q.type === 'qr' ? 'QR'
                : q.type === 'img'
                ? (q.file_id
                  ? <img src={'/api/files/' + q.file_id} alt="" draggable={false}
                      style={{ width: '100%', display: 'block', pointerEvents: 'none' }} />
                  : '✍ ' + q.label)
                : chipText(q)}
            </div>
          ))}
        </div>

        {f && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10, fontSize: 13 }}>
            <b style={{ minWidth: 130 }}>
              {f.key.startsWith('custom_')
                ? <input value={f.label} onChange={(e) => upd(sel, { label: e.target.value })} style={{ width: 140 }} />
                : f.label}
            </b>
            {!AUTO_KEYS.includes(f.key) && f.type !== 'qr' && (
              <select value={f.type === 'img' ? 'img' : 'text'} style={{ fontSize: 12 }}
                onChange={(e) => upd(sel, e.target.value === 'img'
                  ? { type: 'img', w: f.w && f.w <= 40 ? f.w : 18 }
                  : { type: undefined, size: f.size || 12, w: f.w || 40 })}>
                <option value="text">Text</option>
                <option value="img">Image</option>
              </select>
            )}
            {f.type === 'qr' ? (
              <>
                <label className="muted mini">QR size %</label>
                <input type="number" min="4" max="25" style={{ width: 64 }} value={f.qsize || 9}
                  onChange={(e) => upd(sel, { qsize: Number(e.target.value) || 9 })} />
                <span className="muted mini">Scanning it opens the hub's verification page for that certificate.</span>
              </>
            ) : f.type === 'img' ? (
              <>
                <label className="muted mini">width %</label>
                <input type="number" min="4" max="60" style={{ width: 60 }} value={f.w || 18}
                  onChange={(e) => upd(sel, { w: Number(e.target.value) || 18 })} />
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
              </>
            ) : (
              <>
                <label className="muted mini">size</label>
                <input type="number" min="6" max="72" style={{ width: 60 }} value={f.size}
                  onChange={(e) => upd(sel, { size: Number(e.target.value) || 12 })} />
                <label className="muted mini">width %</label>
                <input type="number" min="10" max="96" style={{ width: 60 }} value={f.w || 60}
                  onChange={(e) => upd(sel, { w: Number(e.target.value) || 60 })} />
                <label className="muted mini">colour</label>
                <input type="color" value={f.color || '#333333'} onChange={(e) => upd(sel, { color: e.target.value })} />
                <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={Boolean(f.bold)} onChange={(e) => upd(sel, { bold: e.target.checked })} /> bold
                </label>
              </>
            )}
            {!AUTO_KEYS.includes(f.key) && f.type !== 'qr' && f.type !== 'img' && (
              <input style={{ flex: 1, minWidth: 220 }} value={f.value || ''}
                placeholder={f.key === 'desc' ? 'Default description (editable while generating)' : 'Default text (editable while generating)'}
                onChange={(e) => upd(sel, { value: e.target.value })} />
            )}
            <button className="btn link" title="Remove this field from the certificate"
              onClick={() => { setFields((fs) => fs.filter((_, j) => j !== sel)); setSel(0); }}>✕ remove</button>
          </div>
        )}

        {err && <p className="err">{err}</p>}
        <div className="form-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn gold" onClick={save}>Save template</button>
          <button className="btn" onClick={addCustom}>+ Add custom field</button>
          <a className="btn" href={`/api/certs/templates/${tpl.id}/preview`} target="_blank" rel="noreferrer"
            title="Opens the real PDF with sample data — save first to see your latest changes">Preview PDF</a>
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
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ---- Main page ------------------------------------------------------------
export default function Certificates() {
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [tid, setTid] = useState('');
  const [parts, setParts] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const [tplId, setTplId] = useState('');
  const [genVals, setGenVals] = useState({});
  const [newTpl, setNewTpl] = useState(null);   // {name, bg_file_id, bg_name}
  const [editTpl, setEditTpl] = useState(null); // template open in the visual editor
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const loadTemplates = () => api.get('/api/certs/templates').then(setTemplates).catch((e) => setErr(e.message));
  useEffect(() => {
    loadTemplates();
    api.get('/api/trainings').then((rows) => setTrainings(rows.filter((t) => t.status !== 'cancelled')))
      .catch((e) => setErr(e.message));
  }, []);

  // The chosen template's fillable fields drive the generation inputs.
  const chosenTpl = templates.find((t) => t.id === Number(tplId));
  const fillable = (Array.isArray(chosenTpl?.layout?.fields) ? chosenTpl.layout.fields : [])
    .filter((f) => f.type !== 'qr' && f.type !== 'img' && !AUTO_KEYS.includes(f.key) && !f.hidden);
  useEffect(() => {
    const v = {};
    fillable.forEach((f) => { v[f.key] = f.value || ''; });
    setGenVals(v);
  }, [tplId, templates]);

  const loadParts = async (id) => {
    setTid(id); setParts(null); setChecked(new Set());
    if (!id) return;
    try {
      const rows = await api.get('/api/certs/training/' + id);
      setParts(rows);
      setChecked(new Set(rows.filter((p) => !p.cert_id && p.att_pct !== null && p.att_pct >= ELIGIBLE_PCT).map((p) => p.id)));
    } catch (e) { setErr(e.message); }
  };

  const toggle = (id) => setChecked((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const generate = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post(`/api/certs/training/${tid}/generate`, {
        template_id: tplId || null, employee_ids: [...checked], values: genVals,
      });
      toast(`${r.issued} certificate(s) generated${r.skipped.length ? ` · ${r.skipped.length} skipped (already issued)` : ''}.`);
      loadParts(tid);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const emailAll = async (resend) => {
    if (!confirm(resend
      ? 'Re-send every issued certificate for this training by e-mail?'
      : 'E-mail each participant their certificate (only ones not yet e-mailed)?')) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post(`/api/certs/training/${tid}/email`, { resend });
      toast(`${r.sent} e-mail(s) sent${r.failed.length ? ` · failed: ${r.failed.join('; ')}` : ''}${r.info ? ' — ' + r.info : ''}`);
      loadParts(tid);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const revoke = async (p) => {
    const reason = prompt(`Revoke certificate ${p.cert_no} for ${p.name}?\n(Lets you regenerate it — e.g. after a name correction.)\nReason:`);
    if (!reason?.trim()) return;
    try {
      await api.del(`/api/certs/${p.cert_id}?reason=` + encodeURIComponent(reason.trim()));
      toast('Certificate revoked — you can generate a fresh one.');
      loadParts(tid);
    } catch (e) { setErr(e.message); }
  };

  // Create the template, then open the visual editor straight away so the
  // field positions can be marked on the uploaded design.
  const saveNewTpl = async () => {
    try {
      const tpl = await api.post('/api/certs/templates', newTpl);
      setNewTpl(null);
      await loadTemplates();
      setEditTpl(tpl);
    } catch (e) { setErr(e.message); }
  };

  const t = trainings.find((x) => x.id === Number(tid));

  return (
    <div>
      <div className="page-head"><h2>Certificates</h2></div>

      <details className="card" style={{ marginBottom: 16 }} open={!templates.length}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>🖼 Templates ({templates.length}) — upload designs &amp; place the text</summary>
        <p className="muted mini" style={{ margin: '8px 0' }}>
          Upload your certificate design (A4 landscape — JPG, PNG or PDF) — the editor then opens on the design
          itself so you can <b>drag into place</b> the participant's name, the description, the training
          name, the date of issue, the authorised signatory, the scan-to-verify QR and any custom fields.
        </p>
        {templates.map((tp) => (
          <div key={tp.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px dashed var(--line)', fontSize: 13 }}>
            <b style={{ flex: 1, minWidth: 160 }}>{tp.name}</b>
            <span className="muted mini">{tp.bg_name || 'built-in background'}</span>
            <button className="btn gold" onClick={() => setEditTpl(tp)}>Open editor</button>
            <a className="btn" href={`/api/certs/templates/${tp.id}/preview`} target="_blank" rel="noreferrer">Preview</a>
            <button className="btn" onClick={async () => {
              if (!confirm(`Remove template "${tp.name}" from the list? Issued certificates stay as they are.`)) return;
              await api.patch('/api/certs/templates/' + tp.id, { active: false });
              loadTemplates();
            }}>✕</button>
          </div>
        ))}
        {!templates.length && <p className="muted mini">No templates yet — the built-in design is used until you add one.</p>}
        {!newTpl ? (
          <button className="btn gold" style={{ marginTop: 10 }} onClick={() => setNewTpl({ name: '', bg_file_id: null, bg_name: '' })}>+ New template</button>
        ) : (
          <div className="card" style={{ padding: 12, marginTop: 10 }}>
            <div className="form-grid">
              <div><label>Template name *</label>
                <input value={newTpl.name} onChange={(e) => setNewTpl({ ...newTpl, name: e.target.value })} placeholder="e.g. Avana gold border 2026" /></div>
              <div><label>Certificate design (A4 landscape — JPG, PNG or PDF)</label>
                <input type="file" accept="image/png,image/jpeg,application/pdf" onChange={async (e) => {
                  if (!e.target.files.length) return;
                  try {
                    const [f] = await apiUpload(e.target.files);
                    setNewTpl({ ...newTpl, bg_file_id: f.id, bg_name: f.name });
                  } catch (e2) { setErr(e2.message); }
                }} />
                {newTpl.bg_name && <span className="muted mini">✓ {newTpl.bg_name}</span>}</div>
            </div>
            <div className="form-actions">
              <button className="btn gold" disabled={!newTpl.name.trim()} onClick={saveNewTpl}>Save &amp; place the text →</button>
              <button className="btn" onClick={() => setNewTpl(null)}>Cancel</button>
            </div>
          </div>
        )}
      </details>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>🎓 Generate certificates</h3>
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <select value={tid} onChange={(e) => loadParts(e.target.value)} style={{ maxWidth: 420 }}>
            <option value="">— choose a training —</option>
            {trainings.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.title}{x.batch ? ' — ' + x.batch : ''}</option>)}
          </select>
          <select value={tplId} onChange={(e) => setTplId(e.target.value)}>
            <option value="">Built-in design</option>
            {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
          </select>
          {parts && (
            <>
              <button className="btn gold" disabled={busy || !checked.size} onClick={generate}>
                {busy ? 'Working…' : `Generate for ${checked.size} participant(s)`}</button>
              <button className="btn" disabled={busy} onClick={() => emailAll(false)}>✉ E-mail certificates</button>
              <button className="btn" disabled={busy} onClick={() => emailAll(true)} title="Send again to everyone, incl. already e-mailed">✉ Re-send all</button>
            </>
          )}
        </div>
        {fillable.length > 0 && tid && (
          <div style={{ margin: '4px 0 8px' }}>
            {fillable.map((f) => (
              <div key={f.key} style={{ marginTop: 6 }}>
                <label className="muted mini">{f.label}{f.key === 'desc' ? ' (printed on every certificate in this batch)' : ''}</label>
                <textarea rows={f.key === 'desc' ? 2 : 1} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }}
                  value={genVals[f.key] || ''}
                  onChange={(e) => setGenVals({ ...genVals, [f.key]: e.target.value })} />
              </div>
            ))}
          </div>
        )}
        {t && <p className="muted mini">{fmtRange(t.days || [])}{t.location ? ' · ' + t.location : ''} ·
          eligibility: ≥{ELIGIBLE_PCT}% attendance (pre-ticked); tick others to override.</p>}
        {err && <p className="err" onClick={() => setErr(null)}>{err}</p>}
        {parts && (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>
                <th><input type="checkbox"
                  checked={parts.length > 0 && parts.every((p) => p.cert_id || checked.has(p.id))}
                  onChange={(e) => setChecked(e.target.checked
                    ? new Set(parts.filter((p) => !p.cert_id).map((p) => p.id)) : new Set())} /></th>
                <th>Employee ID</th><th>Name</th><th style={{ textAlign: 'right' }}>Attendance</th>
                <th>Eligible</th><th>Certificate</th><th /></tr></thead>
              <tbody>
                {parts.map((p) => {
                  const eligible = p.att_pct !== null && p.att_pct >= ELIGIBLE_PCT;
                  return (
                    <tr key={p.id}>
                      <td>{!p.cert_id && <input type="checkbox" checked={checked.has(p.id)} onChange={() => toggle(p.id)} />}</td>
                      <td className="muted mini">{p.zoho_emp_id || '—'}</td>
                      <td>{p.name}</td>
                      <td style={{ textAlign: 'right' }}>{p.att_pct === null ? <span className="muted mini">not marked</span> : p.att_pct + '%'}</td>
                      <td>{eligible ? <span className="pill good mini">Eligible</span>
                        : <span className="pill crit mini" title={p.att_pct === null ? 'No attendance marked yet' : `Below ${ELIGIBLE_PCT}%`}>Not eligible</span>}</td>
                      <td>
                        {p.cert_id ? (
                          <>
                            <a href={'/api/files/' + p.file_id} target="_blank" rel="noreferrer">📜 {p.cert_no}</a>
                            <span className="muted mini"> · {fmtDate(p.issued_at)}{p.emailed_at ? ' · ✉ sent' : ''}</span>
                          </>
                        ) : <span className="muted mini">—</span>}
                      </td>
                      <td>{p.cert_id && <button className="btn link" onClick={() => revoke(p)}>revoke</button>}</td>
                    </tr>
                  );
                })}
                {!parts.length && <tr><td colSpan={7} className="muted">This training has no participants.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {!parts && tid && <p className="muted">Loading…</p>}
      </div>

      {editTpl && (
        <TplEditor tpl={editTpl} onClose={() => setEditTpl(null)}
          onSaved={() => { setEditTpl(null); loadTemplates(); }} />
      )}
    </div>
  );
}

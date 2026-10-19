import React, { useEffect, useState } from 'react';
import { api, apiUpload, fmtDate, fmtRange } from '../api.js';
import { useToast } from '../App.jsx';

const ELIGIBLE_PCT = 75;

// Certificates: upload background templates, pick a training and its
// participants, generate personalised PDFs in bulk (duplicates blocked),
// e-mail them out; participants also download theirs on the learner portal.
export default function Certificates() {
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [tid, setTid] = useState('');
  const [parts, setParts] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const [tplId, setTplId] = useState('');
  const [newTpl, setNewTpl] = useState(null);   // {name, bg_file_id, bg_name}
  const [editTpl, setEditTpl] = useState(null); // layout editor
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const loadTemplates = () => api.get('/api/certs/templates').then(setTemplates).catch((e) => setErr(e.message));
  useEffect(() => {
    loadTemplates();
    api.get('/api/trainings').then((rows) => setTrainings(rows.filter((t) => t.status !== 'cancelled')))
      .catch((e) => setErr(e.message));
  }, []);

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
        template_id: tplId || null, employee_ids: [...checked],
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

  const saveNewTpl = async () => {
    try {
      await api.post('/api/certs/templates', newTpl);
      toast('Template saved — use Preview to check the text positions.');
      setNewTpl(null); loadTemplates();
    } catch (e) { setErr(e.message); }
  };

  const t = trainings.find((x) => x.id === Number(tid));
  const num = (v) => (v === '' || v === null || isNaN(Number(v)) ? undefined : Number(v));

  return (
    <div>
      <div className="page-head"><h2>Certificates</h2></div>

      <details className="card" style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>🖼 Templates ({templates.length}) — background designs &amp; text positions</summary>
        <p className="muted mini" style={{ margin: '8px 0' }}>
          Upload your certificate design as an image (A4 landscape, JPG/PNG). The hub prints the
          participant's name, the training name and the dates on top — adjust the positions below and
          check with <b>Preview</b>. With no template, a clean built-in design is used.
        </p>
        {templates.map((tp) => (
          <div key={tp.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px dashed var(--line)', fontSize: 13 }}>
            <b style={{ flex: 1, minWidth: 160 }}>{tp.name}</b>
            <span className="muted mini">{tp.bg_name || 'built-in background'}</span>
            <a className="btn" href={`/api/certs/templates/${tp.id}/preview`} target="_blank" rel="noreferrer">Preview</a>
            <button className="btn" onClick={() => setEditTpl({ ...tp, layout: { ...tp.layout } })}>Adjust text</button>
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
              <div><label>Background image (A4 landscape JPG/PNG, optional)</label>
                <input type="file" accept="image/png,image/jpeg" onChange={async (e) => {
                  if (!e.target.files.length) return;
                  try {
                    const [f] = await apiUpload(e.target.files);
                    setNewTpl({ ...newTpl, bg_file_id: f.id, bg_name: f.name });
                  } catch (e2) { setErr(e2.message); }
                }} />
                {newTpl.bg_name && <span className="muted mini">✓ {newTpl.bg_name}</span>}</div>
            </div>
            <div className="form-actions">
              <button className="btn gold" disabled={!newTpl.name.trim()} onClick={saveNewTpl}>Save template</button>
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
        <div className="modal-backdrop" onClick={() => setEditTpl(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <h3>Adjust text — {editTpl.name}</h3>
            <p className="muted mini">Positions are % from the top of the page. Save, then use Preview to check.</p>
            {[['name', 'Participant name'], ['title', 'Training name'], ['dates', 'Dates / location line']].map(([k, label]) => (
              <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', fontSize: 13, flexWrap: 'wrap' }}>
                <span style={{ width: 150 }}>{label}</span>
                <label className="muted mini">top %</label>
                <input type="number" min="5" max="95" style={{ width: 70 }} value={editTpl.layout[k + '_y'] ?? ''}
                  onChange={(e) => setEditTpl({ ...editTpl, layout: { ...editTpl.layout, [k + '_y']: num(e.target.value) } })} />
                <label className="muted mini">size</label>
                <input type="number" min="6" max="72" style={{ width: 70 }} value={editTpl.layout[k + '_size'] ?? ''}
                  onChange={(e) => setEditTpl({ ...editTpl, layout: { ...editTpl.layout, [k + '_size']: num(e.target.value) } })} />
                <label className="muted mini">colour</label>
                <input type="color" value={editTpl.layout[k + '_color'] || '#333333'}
                  onChange={(e) => setEditTpl({ ...editTpl, layout: { ...editTpl.layout, [k + '_color']: e.target.value } })} />
              </div>
            ))}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 6 }}>
              <input type="checkbox" checked={editTpl.layout.show_cert_no !== false}
                onChange={(e) => setEditTpl({ ...editTpl, layout: { ...editTpl.layout, show_cert_no: e.target.checked } })} />
              Print the certificate number (bottom-right)
            </label>
            <div className="form-actions">
              <button className="btn gold" onClick={async () => {
                try {
                  await api.patch('/api/certs/templates/' + editTpl.id, { layout: editTpl.layout });
                  toast('Template updated — open Preview to check.');
                  setEditTpl(null); loadTemplates();
                } catch (e) { setErr(e.message); }
              }}>Save</button>
              <a className="btn" href={`/api/certs/templates/${editTpl.id}/preview`} target="_blank" rel="noreferrer">Preview current</a>
              <button className="btn" onClick={() => setEditTpl(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

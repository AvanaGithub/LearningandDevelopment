import React, { useEffect, useState } from 'react';
import { api, apiUpload, fmtDate, fmtRange } from '../api.js';
import { useToast } from '../App.jsx';
import CertEditor, { AUTO_KEYS, isMulti } from '../components/CertEditor.jsx';

const ELIGIBLE_PCT = 75;

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
  // Default to the newest template rather than the built-in design — an
  // uploaded template is almost always the one meant.
  const [tplPicked, setTplPicked] = useState(false);
  useEffect(() => {
    if (!tplPicked && tplId === '' && templates.length) setTplId(String(templates[0].id));
  }, [templates]);

  const reissue = async () => {
    const tplName = templates.find((x) => x.id === Number(tplId))?.name || 'the built-in design';
    const n = (parts || []).filter((p) => p.cert_id).length;
    if (!confirm(`Re-make the ${n} already-issued certificate(s) on this training with "${tplName}"?\n\n` +
      'Certificate numbers and issue dates stay the same, so their QR codes keep working. ' +
      'You can then e-mail the new versions.')) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post(`/api/certs/training/${tid}/reissue`, { template_id: tplId || null, values: genVals });
      toast(`${r.reissued} certificate(s) re-issued with ${tplName} — use ✉ E-mail certificates to send the new versions.`);
      loadParts(tid);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  useEffect(() => {
    loadTemplates();
    api.get('/api/trainings').then((rows) => setTrainings(rows.filter((t) => t.status !== 'cancelled')))
      .catch((e) => setErr(e.message));
  }, []);

  // The chosen template's fillable fields drive the generation inputs.
  const chosenTpl = templates.find((t) => t.id === Number(tplId));
  const fillable = (Array.isArray(chosenTpl?.layout?.fields) ? chosenTpl.layout.fields : [])
    .filter((f) => (!f.type || f.type === 'text') && !AUTO_KEYS.includes(f.key) && !f.hidden);
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
          Upload your certificate design (JPG, PNG or PDF — any size; certificates take its proportions) —
          the editor then opens on the design itself so you can <b>drag into place</b> the participant's
          name, the description, the training name, the date of issue, the authorised signatory, the
          scan-to-verify QR and any custom fields, each in its own font.
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
              <div><label>Certificate design (JPG, PNG or PDF)</label>
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
          <select value={tplId} onChange={(e) => { setTplId(e.target.value); setTplPicked(true); }}
            title="The design the certificates are printed on">
            {templates.map((tp) => <option key={tp.id} value={tp.id}>Template: {tp.name}</option>)}
            <option value="">Built-in design</option>
          </select>
          {parts && (
            <>
              <button className="btn gold" disabled={busy || !checked.size} onClick={generate}>
                {busy ? 'Working…' : `Generate for ${checked.size} participant(s)`}</button>
              {parts.some((p) => p.cert_id) && (
                <button className="btn" disabled={busy} onClick={reissue}
                  title="Re-make already-issued certificates with the selected template (same numbers)">↻ Re-issue with this template</button>
              )}
              <button className="btn" disabled={busy} onClick={() => emailAll(false)}>✉ E-mail certificates</button>
              <button className="btn" disabled={busy} onClick={() => emailAll(true)} title="Send again to everyone, incl. already e-mailed">✉ Re-send all</button>
            </>
          )}
        </div>
        {fillable.length > 0 && tid && (
          <div style={{ margin: '4px 0 8px' }}>
            {fillable.map((f) => (
              <div key={f.key} style={{ marginTop: 6 }}>
                <label className="muted mini">
                  {f.label}{f.key === 'desc' ? ' (printed on every certificate in this batch)' : ''}
                  {isMulti(f) ? ' — multi-line, press Enter for a new line' : ''}
                </label>
                {isMulti(f)
                  ? <textarea rows={3} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }}
                      value={genVals[f.key] || ''}
                      onChange={(e) => setGenVals({ ...genVals, [f.key]: e.target.value })} />
                  : <input style={{ width: '100%' }} value={genVals[f.key] || ''}
                      onChange={(e) => setGenVals({ ...genVals, [f.key]: e.target.value })} />}
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
                            <span className={'pill mini ' + (p.template_id ? 'soft' : 'warn')} style={{ marginLeft: 6 }}>
                              {p.template_id ? p.template_name || 'template' : 'built-in design'}</span>
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
        <CertEditor tpl={editTpl} onClose={() => setEditTpl(null)}
          onSaved={() => { setEditTpl(null); loadTemplates(); }} />
      )}
    </div>
  );
}

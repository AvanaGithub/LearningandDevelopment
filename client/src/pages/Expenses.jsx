import React, { useEffect, useState } from 'react';
import { api, apiUpload, ENTITIES, ENTITY_NAMES, EXP_CATEGORIES, fmtRange, inr } from '../api.js';
import { useToast, useSettings } from '../App.jsx';
import { toXlsx } from '../xlsx.js';

const paidOf = (r) => (r.payments || []).reduce((a, p) => a + Number(p.amt), 0);
// Manual override (payment_status) wins; otherwise computed from payments.
const payStatus = (r) => {
  if (r.payment_status === 'paid') return ['Paid', 'good'];
  if (r.payment_status === 'partial') return ['Partially paid', 'warn'];
  if (r.payment_status === 'unpaid') return ['Not paid', 'crit'];
  const paid = paidOf(r);
  if (Number(r.actual) > 0 && paid >= Number(r.actual)) return ['Paid', 'good'];
  if (paid > 0) return ['Partially paid', 'warn'];
  return ['Not paid', 'crit'];
};
const APPR = { pending: ['Pending', 'warn'], approved: ['Approved', 'good'], rejected: ['Rejected', 'crit'] };

// Indian financial year label, Apr–Mar (e.g. "2026–27").
const fyLabel = () => {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}–${String(y + 1).slice(2)}`;
};

const EMPTY = {
  training_id: '', training_label: '', dates: '', location: '', participants: '',
  entity_split: { AMD: '', ASS: '', ATS: '' }, category: EXP_CATEGORIES[0], training_type: 'Internal',
  vendor: '', description: '', budget: '', actual: '', payments: [{ date: '', amt: '', invoices: [] }],
  invoices: '', approval: 'pending', payment_status: '', remark: '', reason: '',
};

export default function Expenses() {
  const toast = useToast();
  const { settings } = useSettings();
  const [rows, setRows] = useState(null);
  const [trainings, setTrainings] = useState([]);
  const [form, setForm] = useState(null);
  const [sel, setSel] = useState(null);
  const [cancelReason, setCancelReason] = useState(null);
  const [err, setErr] = useState(null);

  const load = () => api.get('/api/expenses').then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); api.get('/api/trainings').then(setTrainings).catch(() => {}); }, []);

  const toBody = (f) => ({
    ...f,
    training_id: f.training_id || null,
    participants: Number(f.participants) || 0,
    entity_split: ENTITIES.filter((e) => Number(f.entity_split[e]) > 0).map((e) => ({ ent: e, n: Number(f.entity_split[e]) })),
    budget: Number(f.budget), actual: Number(f.actual),
    payments: f.payments.filter((p) => p.date && Number(p.amt) > 0)
      .map((p) => ({ date: p.date, amt: Number(p.amt), invoices: p.invoices || [] })),
    invoices: f.invoices.split(',').map((s) => s.trim()).filter(Boolean),
    payment_status: f.payment_status || null,
  });

  const attachInvoices = async (i, files) => {
    try {
      const up = await apiUpload(files);
      setForm((f) => {
        const ps = [...f.payments];
        ps[i] = { ...ps[i], invoices: [...(ps[i].invoices || []), ...up] };
        return { ...f, payments: ps };
      });
      toast(up.length + ' invoice file(s) attached to this payment.');
    } catch (e2) { setErr(e2.message); }
  };

  const save = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      if (form.id) {
        await api.patch('/api/expenses/' + form.id, toBody(form));
        toast('Expense record updated — pending, variance and entity split recomputed.');
      } else {
        await api.post('/api/expenses', toBody(form));
        toast('Expense record saved — entity shares split by headcount.');
      }
      setForm(null); setSel(null); load();
    } catch (e2) { setErr(e2.message); }
  };

  const edit = (r) => {
    setSel(null);
    const split = { AMD: '', ASS: '', ATS: '' };
    (r.entity_split || []).forEach((s) => { split[s.ent] = s.n; });
    setForm({
      id: r.id, training_id: r.training_id || '', training_label: r.training_label,
      dates: r.dates || '', location: r.location || '', participants: r.participants || '',
      entity_split: split, category: r.category || EXP_CATEGORIES[0],
      training_type: r.training_type || 'Internal', vendor: r.vendor || '',
      description: r.description || '', budget: r.budget, actual: r.actual,
      payments: (r.payments || []).length ? r.payments.map((p) => ({ invoices: [], ...p })) : [{ date: '', amt: '', invoices: [] }],
      invoices: (r.invoices || []).join(', '), approval: r.approval,
      payment_status: r.payment_status || '', remark: r.remark || '', reason: '',
    });
    setErr(null);
  };

  const cancelRec = async () => {
    try {
      await api.patch('/api/expenses/' + sel.id, { active: false, reason: cancelReason.trim() });
      toast('Expense record cancelled — reason recorded in the audit trail.');
      setCancelReason(null); setSel(null); load();
    } catch (e2) { setErr(e2.message); }
  };

  const pickTraining = (id) => {
    const t = trainings.find((x) => x.id === Number(id));
    if (!t) return setForm({ ...form, training_id: id });
    setForm({
      ...form, training_id: id,
      training_label: t.title + (t.batch ? ' — ' + t.batch : ''),
      dates: fmtRange(t.days),
      participants: t.participant_count || form.participants,
      training_type: t.trainer_type === 'external' ? 'External' : 'Internal',
      vendor: t.trainer_type === 'external' ? (t.agency || form.vendor) : form.vendor,
    });
  };

  const totalSplit = form ? ENTITIES.reduce((a, e) => a + (Number(form.entity_split[e]) || 0), 0) : 0;

  return (
    <>
      <div className="page-head">
        <h2>Expenses</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => toXlsx('Expense-Records.xlsx',
            ['Training', 'Dates', 'Location', 'Participants', 'Entities', 'Category', 'Type', 'Vendor', 'Description',
              'Budget', 'Actual', 'Paid', 'Pending', 'Variance', 'Approval', 'Payment status', 'Payments', 'Invoices', 'Remark'],
            (rows || []).map((r) => {
              const paid = paidOf(r);
              return [r.training_label, r.dates || '', r.location || '', r.participants,
                (r.entity_split || []).map((s) => `${s.ent} ${s.n}`).join(' | '), r.category || '', r.training_type || '',
                r.vendor || '', r.description || '', Number(r.budget), Number(r.actual), paid,
                Number(r.actual) - paid, Number(r.budget) - Number(r.actual), r.approval, payStatus(r)[0],
                (r.payments || []).map((p) => `${p.date} ₹${p.amt}`).join(' | '),
                (r.invoices || []).join(' | '), r.remark || ''];
            }), 'Expenses')}>⬇ Export</button>
          <button className="btn gold" onClick={() => { setForm(JSON.parse(JSON.stringify(EMPTY))); setErr(null); }}>New expense record</button>
        </div>
      </div>

      {form && (
        <form className="card" onSubmit={save}>
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>{form.id ? 'Edit expense record' : 'New expense record'}</h3>
          <div className="form-grid">
            <div><label>Training</label>
              <select value={form.training_id} onChange={(e) => pickTraining(e.target.value)}>
                <option value="">— pick or type the label —</option>
                {trainings.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.title}{t.batch ? ' — ' + t.batch : ''}</option>)}
              </select></div>
            <div><label>Training name (label) *</label>
              <input required value={form.training_label} onChange={(e) => setForm({ ...form, training_label: e.target.value })} /></div>
            <div><label>Training dates</label>
              <input value={form.dates} onChange={(e) => setForm({ ...form, dates: e.target.value })} /></div>
            <div><label>Training location</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            <div><label>Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {EXP_CATEGORIES.map((x) => <option key={x}>{x}</option>)}
              </select></div>
            <div><label>Training type</label>
              <select value={form.training_type} onChange={(e) => setForm({ ...form, training_type: e.target.value })}>
                <option>Internal</option><option>External</option>
              </select></div>
            {form.training_type === 'External' &&
              <div><label>Vendor name</label>
                <input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></div>}
            <div><label>Approved budget ₹ *</label>
              <input required type="number" min="1" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></div>
            <div><label>Actual expense ₹ *</label>
              <input required type="number" min="1" value={form.actual} onChange={(e) => setForm({ ...form, actual: e.target.value })} /></div>
            <div><label>Approval status</label>
              <select value={form.approval} onChange={(e) => setForm({ ...form, approval: e.target.value })}>
                <option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
              </select></div>
            <div><label>Payment status</label>
              <select value={form.payment_status} onChange={(e) => setForm({ ...form, payment_status: e.target.value })}>
                <option value="">Auto (from payment rows)</option>
                <option value="paid">Paid</option>
                <option value="partial">Partially paid</option>
                <option value="unpaid">Not paid</option>
              </select></div>
          </div>

          <p className="muted mini" style={{ margin: '12px 0 4px' }}>Entities covered — participant count per entity; cost splits pro-rata by headcount:</p>
          <div className="form-grid">
            {ENTITIES.map((e) => (
              <div key={e}><label>{ENTITY_NAMES[e]}</label>
                <input type="number" min="0" placeholder="participants" value={form.entity_split[e]}
                  onChange={(ev) => setForm({ ...form, entity_split: { ...form.entity_split, [e]: ev.target.value }, participants: '' })} /></div>
            ))}
            <div><label>Total participants</label>
              <input readOnly value={totalSplit || form.participants || 0} style={{ background: 'var(--panel2)' }} /></div>
          </div>

          <p className="muted mini" style={{ margin: '12px 0 4px' }}>Payment dates &amp; amounts — one row per part-payment; pending and status compute automatically:</p>
          {form.payments.map((p, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="date" value={p.date} onChange={(e) => {
                  const ps = [...form.payments]; ps[i] = { ...p, date: e.target.value }; setForm({ ...form, payments: ps });
                }} />
                <input type="number" min="0" placeholder="Amount ₹" value={p.amt} onChange={(e) => {
                  const ps = [...form.payments]; ps[i] = { ...p, amt: e.target.value }; setForm({ ...form, payments: ps });
                }} />
                <label className="btn" style={{ cursor: 'pointer' }}>📎 Invoices
                  <input type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.xlsx,.doc,.docx"
                    onChange={(e) => e.target.files.length && attachInvoices(i, e.target.files)} />
                </label>
                <button className="btn" type="button" onClick={() => setForm({ ...form, payments: form.payments.filter((_, j) => j !== i) })}>✕</button>
              </div>
              {(p.invoices || []).length > 0 && (
                <div style={{ fontSize: 12, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {p.invoices.map((inv, k) => (
                    <span key={inv.id} className="pill soft">📄 {inv.name}
                      <button type="button" className="btn link" style={{ padding: '0 2px' }} onClick={() => {
                        const ps = [...form.payments];
                        ps[i] = { ...p, invoices: p.invoices.filter((_, j) => j !== k) };
                        setForm({ ...form, payments: ps });
                      }}>✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button className="btn" type="button" onClick={() => setForm({ ...form, payments: [...form.payments, { date: '', amt: '', invoices: [] }] })}>+ Add payment row</button>

          <div className="form-grid" style={{ marginTop: 12 }}>
            <div><label>Description</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div><label>Invoice file names (comma-separated)</label>
              <input value={form.invoices} placeholder="Invoice-4471.pdf, GST-2211.pdf"
                onChange={(e) => setForm({ ...form, invoices: e.target.value })} /></div>
            <div><label>Remark</label>
              <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} /></div>
            {form.id && <div><label>Reason for this correction</label>
              <input value={form.reason} placeholder="Goes to the audit trail (optional)"
                onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>}
          </div>
          {err && <p className="err">{err}</p>}
          <div className="form-actions">
            <button className="btn gold" type="submit">Save</button>
            <button className="btn" type="button" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      {!rows ? <p className="muted">{err || 'Loading…'}</p> : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ minWidth: 900 }}>
            <thead><tr>
              <th>Training</th><th>Dates</th><th>Category</th><th>Entities</th>
              <th style={{ textAlign: 'right' }}>Budget ₹</th><th style={{ textAlign: 'right' }}>Actual ₹</th>
              <th style={{ textAlign: 'right' }}>Paid ₹</th><th style={{ textAlign: 'right' }}>Pending ₹</th>
              <th style={{ textAlign: 'right' }}>Variance ₹</th><th>Approval</th><th>Payment</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const paid = paidOf(r);
                const pend = Number(r.actual) - paid;
                const varr = Number(r.budget) - Number(r.actual);
                const [ps, pc] = payStatus(r);
                const [as, ac] = APPR[r.approval];
                return (
                  <tr key={r.id} className="rowlink" onClick={() => { setSel(r); setCancelReason(null); setErr(null); }}>
                    <td>{r.training_label}</td>
                    <td className="muted">{r.dates}</td>
                    <td>{r.category}</td>
                    <td>{(r.entity_split || []).map((s) => <span key={s.ent} className="pill soft mini" style={{ marginRight: 4 }}>{s.ent} {s.n}</span>)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(r.budget)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(r.actual)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(paid)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(pend)}</td>
                    <td style={{ textAlign: 'right', color: varr >= 0 ? 'var(--good)' : 'var(--crit)' }}>{varr >= 0 ? '+' : ''}{inr(varr)}</td>
                    <td><span className={'pill ' + ac}>{as}</span></td>
                    <td><span className={'pill ' + pc}>{ps}</span></td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={11} className="muted">No expense records yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {rows && (
        <div className="card">
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>Budget vs actual — FY {fyLabel()}</h3>
          <table><tbody>
            {ENTITIES.map((e) => {
              const budget = Number(settings?.entity_budgets?.[e]) || 0;
              const actual = rows.reduce((s, r) => {
                const split = r.entity_split || [];
                const tot = split.reduce((a, x) => a + x.n, 0) || 1;
                const mine = split.find((x) => x.ent === e);
                return s + (mine ? Number(r.actual) * mine.n / tot : 0);
              }, 0);
              const pct = budget ? Math.min(100, Math.round(actual / budget * 100)) : 0;
              return (
                <tr key={e}>
                  <td style={{ width: 220 }}>{ENTITY_NAMES[e]}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>₹{inr(budget)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>₹{inr(actual)}</td>
                  <td style={{ width: '32%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className={'bar' + (pct > 85 ? ' hot' : '')}><i style={{ width: pct + '%' }} /></div>
                      <span className="muted mini">{pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody></table>
          <p className="muted mini" style={{ marginTop: 8 }}>
            Actuals are the entity's pro-rata share of every active record above. Budgets are set under Settings → Annual training budgets.
          </p>
        </div>
      )}

      {sel && (
        <div className="modal-backdrop" onClick={() => setSel(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{sel.training_label} — {sel.category}</h3>
            <dl className="kv">
              <dt>Dates</dt><dd>{sel.dates || '—'}</dd>
              <dt>Location</dt><dd>{sel.location || '—'}</dd>
              <dt>Participants</dt><dd>{sel.participants}</dd>
              <dt>Type / Vendor</dt><dd>{sel.training_type}{sel.vendor ? ' · ' + sel.vendor : ''}</dd>
              <dt>Description</dt><dd>{sel.description || '—'}</dd>
              <dt>Approved budget</dt><dd>₹{inr(sel.budget)}</dd>
              <dt>Actual expense</dt><dd>₹{inr(sel.actual)}</dd>
              <dt>Amount paid</dt><dd>₹{inr(paidOf(sel))}</dd>
              <dt>Amount pending</dt><dd>₹{inr(Number(sel.actual) - paidOf(sel))} <span className="muted">(actual − paid)</span></dd>
              <dt>Variance</dt><dd>₹{inr(Number(sel.budget) - Number(sel.actual))} <span className="muted">(budget − actual)</span></dd>
              <dt>Cost / participant</dt><dd>₹{inr(Number(sel.actual) / Math.max(1, sel.participants))}</dd>
              <dt>Remark</dt><dd>{sel.remark || '—'}</dd>
            </dl>
            <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>Entity split — pro-rata by headcount</h3>
            <table>
              <tbody>
                {(() => {
                  const tot = (sel.entity_split || []).reduce((a, s) => a + s.n, 0) || 1;
                  return (sel.entity_split || []).map((s) => (
                    <tr key={s.ent}><td>{ENTITY_NAMES[s.ent]}</td><td style={{ textAlign: 'right' }}>{s.n}</td>
                      <td style={{ textAlign: 'right' }}>₹{inr(Number(sel.actual) * s.n / tot)}</td></tr>
                  ));
                })()}
              </tbody>
            </table>
            <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>Payments</h3>
            {(sel.payments || []).length ? (
              <table><tbody>{sel.payments.map((p, i) => (
                <tr key={i}><td className="muted">{p.date}</td><td style={{ textAlign: 'right' }}>₹{inr(p.amt)}</td>
                  <td>{(p.invoices || []).map((inv) => (
                    <a key={inv.id} href={'/api/files/' + inv.id} target="_blank" rel="noreferrer" style={{ marginRight: 8, fontSize: 12 }}>📄 {inv.name}</a>
                  ))}</td></tr>))}</tbody></table>
            ) : <p className="muted mini">No payments recorded yet.</p>}
            {(sel.invoices || []).length > 0 && (
              <p className="muted mini" style={{ marginTop: 10 }}>Invoices: {sel.invoices.join(' · ')}</p>
            )}
            {err && <p className="err">{err}</p>}
            {cancelReason === null ? (
              <div className="form-actions">
                <button className="btn gold" onClick={() => edit(sel)}>Edit</button>
                <button className="btn" onClick={() => setCancelReason('')}>Cancel record…</button>
                <button className="btn" onClick={() => setSel(null)}>Close</button>
              </div>
            ) : (
              <div className="form-actions" style={{ flexWrap: 'wrap' }}>
                <input autoFocus placeholder="Reason for cancelling this record (required — audit trail)" value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
                <button className="btn gold" disabled={!cancelReason.trim()} onClick={cancelRec}>Confirm cancel</button>
                <button className="btn" onClick={() => setCancelReason(null)}>Back</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

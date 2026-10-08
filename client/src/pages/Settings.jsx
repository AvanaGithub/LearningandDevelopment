import React, { useState } from 'react';
import { api, ENTITIES, ENTITY_NAMES, inr } from '../api.js';
import { useSettings, useToast } from '../App.jsx';

const LISTS = [
  { key: 'divisions', label: 'Divisions', icon: '🧭', hint: 'Business lines shown on employees, assessments and filters.' },
  { key: 'departments', label: 'Departments', icon: '🏢', hint: 'Functions shown on employees and filters.' },
  { key: 'emp_types', label: 'Employment types', icon: '🪪', hint: 'Options in the employee form.' },
  { key: 'trn_categories', label: 'Training categories', icon: '📚', hint: 'Options when planning a training.' },
  { key: 'trn_modes', label: 'Training modes', icon: '🎓', hint: 'Delivery modes when planning a training.' },
  { key: 'exp_categories', label: 'Expense categories', icon: '🧾', hint: 'Cost heads on expense records.' },
  { key: 'fb_std_questions', label: 'Feedback standard questions', icon: '⭐', hint: 'Question bank offered on every feedback form.' },
  { key: 'joiner_steps', label: 'New-joiner checklist steps', icon: '🧷', hint: 'Tracked per joiner on the New Joiners tab.' },
];

// Lists that feed a form field which can be made mandatory. The tick on a
// row applies to the FIELD (one setting), so all rows move together.
const MANDATE_OF = {
  divisions: { legacy: true, field: 'division', form: 'employee' },
  departments: { legacy: true, field: 'department', form: 'employee' },
  emp_types: { legacy: true, field: 'employment_type', form: 'employee' },
  trn_categories: { section: 'trainings', field: 'category', form: 'training' },
  exp_categories: { section: 'expenses', field: 'category', form: 'expense' },
};

// Mandatory controls for fields that are NOT backed by a master list.
const OTHER_MANDATE = [
  {
    section: 'employees', label: 'Employee form', legacy: true,
    fields: [['zoho_emp_id', 'Zoho employee ID'], ['email', 'Official e-mail'], ['mobile', 'Mobile'],
      ['designation', 'Designation'], ['manager', 'Reporting manager'],
      ['date_joined', 'Date of joining'], ['location', 'Location']],
  },
  {
    section: 'trainings', label: 'Training form',
    fields: [['batch', 'Batch'], ['department', 'Departments'], ['division', 'Divisions'],
      ['mode', 'Mode'], ['validity_months', 'Re-training validity'], ['agenda_file', 'Training agenda']],
  },
  {
    section: 'expenses', label: 'Expense form',
    fields: [['budget', 'Approved budget'], ['dates', 'Training dates'], ['location', 'Location'],
      ['vendor', 'Vendor'], ['description', 'Description'], ['remark', 'Remark'], ['payments', 'Payment rows']],
  },
  {
    section: 'mavericks', label: 'Mavericks batch form',
    fields: [['mentor', 'Programme lead'], ['start_date', 'Start date'], ['end_date', 'End date'], ['notes', 'Notes']],
  },
];

const Strip = ({ icon, children }) => (
  <div className="sect-strip"><span className="sicon">{icon}</span>{children}</div>
);

export default function Settings() {
  const { settings, reloadSettings } = useSettings();
  const toast = useToast();
  const [newItem, setNewItem] = useState({});
  const [smtp, setSmtp] = useState(null);   // local draft of the e-mail settings
  const [tplDraft, setTplDraft] = useState(null); // local draft of e-mail templates
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState(null);

  if (!settings) return <p className="muted">Loading…</p>;
  const sm = smtp || { ...settings.smtp, pass: '', client_secret: '' };
  const rf = settings.required_fields || { trainings: [], expenses: [], mavericks: [] };

  const save = async (key, value, msg) => {
    setErr(null);
    try {
      await api.put('/api/settings/' + key, { value });
      reloadSettings();
      toast(msg || 'Setting saved — applies across the application immediately.');
    } catch (e) { setErr(e.message); }
  };

  const isMandated = (m) => (m.legacy
    ? (settings.required_employee_fields || []).includes(m.field)
    : (rf[m.section] || []).includes(m.field));
  const toggleMandate = (m, label) => {
    const on = isMandated(m);
    const msg = `"${label}" is ${on ? 'optional again' : 'now mandatory'} on the ${m.form || m.section} form.`;
    if (m.legacy) {
      const cur = settings.required_employee_fields || [];
      save('required_employee_fields', on ? cur.filter((x) => x !== m.field) : [...cur, m.field], msg);
    } else {
      const cur = rf[m.section] || [];
      save('required_fields', { ...rf, [m.section]: on ? cur.filter((x) => x !== m.field) : [...cur, m.field] }, msg);
    }
  };

  const saveSmtp = async () => {
    setErr(null);
    try {
      await api.put('/api/settings/smtp', { value: sm });
      reloadSettings(); setSmtp(null);
      toast('E-mail settings saved.');
    } catch (e) { setErr(e.message); }
  };
  const testMail = async () => {
    setTesting(true); setErr(null);
    try {
      const r = await api.post('/api/settings/test-mail', {});
      toast(`Test e-mail sent to ${r.to} — check the inbox.`);
    } catch (e) { setErr(e.message); }
    setTesting(false);
  };

  return (
    <>
      <div className="page-head"><h2>Settings</h2></div>
      <p className="muted" style={{ marginBottom: 6, fontSize: 13 }}>
        Customise the application without a code change. Every change is logged to the audit trail and applies immediately for everyone.
      </p>
      {err && <p className="err">{err}</p>}

      <Strip icon="🗂">Master lists</Strip>
      <div className="cols2">
        {LISTS.map((l) => {
          const all = settings._all?.[l.key] || settings[l.key] || [];
          const dis = settings.disabled_options?.[l.key] || [];
          const enabled = all.filter((x) => !dis.includes(x));
          const m = MANDATE_OF[l.key];
          const mandated = m ? isMandated(m) : false;
          const toggleOption = (item) => {
            const next = dis.includes(item) ? dis.filter((x) => x !== item) : [...dis, item];
            save('disabled_options', { ...settings.disabled_options, [l.key]: next },
              dis.includes(item)
                ? `"${item}" enabled — available again in forms and filters.`
                : `"${item}" disabled — hidden from forms; existing records keep it.`);
          };
          const addItem = () => {
            const v = (newItem[l.key] || '').trim();
            if (!v) return;
            if (all.includes(v)) return setErr(`"${v}" is already in ${l.label}.`);
            save(l.key, [...all, v], `"${v}" added to ${l.label}.`);
            setNewItem({ ...newItem, [l.key]: '' });
          };
          return (
            <details key={l.key} className="card scard setcard" style={{ marginBottom: 16 }}>
              <summary>
                <span className="sicon">{l.icon}</span>{l.label}
                <span className="pill soft mini">{enabled.length}{dis.length ? ` of ${all.length}` : ''}</span>
                {m && mandated && <span className="pill warn mini">mandatory field</span>}
              </summary>
              <p className="muted mini" style={{ margin: '6px 0 2px' }}>
                {l.hint} Toggle an option off to hide it from forms without touching old records.
                {m && <> The <b>Mandatory</b> tick makes the {m.form} form's field required — it is one setting, so every row shows the same state.</>}
              </p>
              <div style={{ marginTop: 6 }}>
                {all.length > 0 && (
                  <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--ink2)', padding: '0 0 2px' }}>
                    <span style={{ width: 34 }}>On</span><span style={{ flex: 1 }}></span>
                    {m && <span>Mandatory</span>}<span style={{ width: 24 }}></span>
                  </div>
                )}
                {all.map((item) => {
                  const on = !dis.includes(item);
                  return (
                    <div key={item} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 0', borderBottom: '1px dashed var(--line)', fontSize: 13 }}>
                      <button type="button" className={'swt' + (on ? ' on' : '')} onClick={() => toggleOption(item)}
                        title={on ? 'Enabled — click to disable' : 'Disabled — click to enable'}><span /></button>
                      <span style={{ flex: 1, color: on ? 'inherit' : 'var(--ink2)', textDecoration: on ? 'none' : 'line-through' }}>{item}</span>
                      {m && (
                        <input type="checkbox" checked={mandated} title={`Make the ${m.form} form's field mandatory`}
                          onChange={() => toggleMandate(m, l.label.replace(/s$/, ''))}
                          style={{ marginRight: 14 }} />
                      )}
                      <button className="btn link" title={`Remove "${item}" permanently`}
                        onClick={() => save(l.key, all.filter((x) => x !== item), `"${item}" removed from ${l.label}. Existing records keep their old value.`)}>✕</button>
                    </div>
                  );
                })}
                {!all.length && <p className="muted mini">Empty — add the first item below.</p>}
              </div>
              <div className="addrow">
                <input placeholder={`Add to ${l.label.toLowerCase()}…`} value={newItem[l.key] || ''}
                  onChange={(e) => setNewItem({ ...newItem, [l.key]: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }} />
                <button className="btn gold" disabled={!(newItem[l.key] || '').trim()} onClick={addItem}>+ Add</button>
              </div>
            </details>
          );
        })}
      </div>

      <Strip icon="✅">Other mandatory fields</Strip>
      <div className="cols2">
        <details className="card scard setcard" style={{ marginBottom: 16 }}>
          <summary><span className="sicon">✅</span>Fields without a master list
            <span className="pill soft mini">
              {(settings.required_employee_fields || []).length + Object.values(rf).reduce((a, x) => a + (x || []).length, 0)} mandatory
            </span>
          </summary>
          <p className="muted mini" style={{ margin: '6px 0 4px' }}>
            Division, department, employment type and the category fields are mandated from their list cards above.
            Everything else is here — gold = mandatory, enforced when saving, including imports.
          </p>
          {OTHER_MANDATE.map((g) => (
            <div key={g.section} style={{ marginBottom: 8 }}>
              <b style={{ fontSize: 12.5 }}>{g.label}</b>
              <div className="chiprow" style={{ marginTop: 4 }}>
                {g.fields.map(([key, label]) => {
                  const m = { legacy: g.legacy, section: g.section, field: key, form: g.label.replace(' form', '') };
                  return (
                    <button key={key} className={'togglechip' + (isMandated(m) ? ' on' : '')}
                      onClick={() => toggleMandate(m, label)}>{label}</button>
                  );
                })}
              </div>
            </div>
          ))}
        </details>
      </div>

      <Strip icon="💰">Budgets</Strip>
      <div className="cols2">
        <details className="card scard setcard" style={{ marginBottom: 16 }}>
          <summary><span className="sicon">💰</span>Annual training budgets
            <span className="pill soft mini">₹{inr(ENTITIES.reduce((a, e) => a + (Number(settings.entity_budgets?.[e]) || 0), 0))}</span>
          </summary>
          <p className="muted mini" style={{ margin: '6px 0 10px' }}>
            Per entity, per financial year — drives the Budget vs actual table on Expenses and the dashboard spend tile.
          </p>
          {ENTITIES.map((e) => (
            <div key={e} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 13 }}>
              <span style={{ flex: 1 }}>{ENTITY_NAMES[e]}</span>
              <input type="number" min="0" style={{ width: 140 }}
                defaultValue={settings.entity_budgets?.[e] ?? 0}
                onBlur={(ev) => {
                  const v = Number(ev.target.value) || 0;
                  if (v !== (settings.entity_budgets?.[e] ?? 0)) {
                    save('entity_budgets', { ...settings.entity_budgets, [e]: v }, `${e} budget set to ₹${inr(v)}.`);
                  }
                }} />
            </div>
          ))}
        </details>
      </div>

      <Strip icon="✉">Integrations</Strip>
      <div className="cols2">
        <details className="card scard setcard" style={{ marginBottom: 16 }}>
          <summary><span className="sicon">✉</span>E-mail notifications (Outlook / Microsoft 365)
            <span className={'pill mini ' + (settings.smtp?.enabled ? 'good' : 'neutral')}>{settings.smtp?.enabled ? 'on' : 'off'}</span>
          </summary>
          <p className="muted mini" style={{ margin: '6px 0 10px' }}>
            Automatic Outlook e-mails: nominees/assignees get the details with a sign-in link; opening
            self-nomination invites every eligible employee; after the nomination deadline managers and
            leaders get the consolidated participant list; when a training is marked completed they get
            the attendance status. Mails never block the action — failures are only logged.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
            <input type="checkbox" checked={sm.enabled} onChange={(e) => setSmtp({ ...sm, enabled: e.target.checked })} />
            Send nomination / assignment e-mails
          </label>
          <div className="form-grid">
            <div><label>Connection method</label>
              <select value={sm.method || 'graph'} onChange={(e) => setSmtp({ ...sm, method: e.target.value })}>
                <option value="graph">Microsoft Graph API (recommended — no app password)</option>
                <option value="smtp">SMTP app password (only if your company allows it)</option>
              </select></div>
            <div><label>Send as (From mailbox)</label>
              <input value={sm.from} onChange={(e) => setSmtp({ ...sm, from: e.target.value, user: e.target.value })} placeholder="academy@avanasurgical.com" /></div>
            <div><label>Sender display name</label>
              <input value={sm.from_name || ''} onChange={(e) => setSmtp({ ...sm, from_name: e.target.value })} placeholder="Avana Academy" /></div>
            <div><label>Test e-mails go to</label>
              <input value={sm.notify} onChange={(e) => setSmtp({ ...sm, notify: e.target.value })} placeholder="lokshni@avanasurgical.com" /></div>
            {(sm.method || 'graph') === 'graph' ? (<>
              <div><label>Directory (tenant) ID</label>
                <input value={sm.tenant_id} onChange={(e) => setSmtp({ ...sm, tenant_id: e.target.value })} placeholder="xxxxxxxx-xxxx-…" /></div>
              <div><label>Application (client) ID</label>
                <input value={sm.client_id} onChange={(e) => setSmtp({ ...sm, client_id: e.target.value })} placeholder="xxxxxxxx-xxxx-…" /></div>
              <div><label>Client secret {settings.smtp?.has_secret ? '(saved — leave blank to keep)' : '(optional)'}</label>
                <input type="password" value={sm.client_secret} onChange={(e) => setSmtp({ ...sm, client_secret: e.target.value })}
                  placeholder={settings.smtp?.has_secret ? '••••••••' : 'leave blank to use the server certificate'} autoComplete="new-password" />
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  Server certificate: {settings.smtp?.cert_available
                    ? <b style={{ color: 'var(--good)' }}>ready ✓</b>
                    : 'not generated yet'}
                </div></div>
            </>) : (
              <div><label>App password {settings.smtp?.has_pass ? '(saved — leave blank to keep)' : '*'}</label>
                <input type="password" value={sm.pass} onChange={(e) => setSmtp({ ...sm, pass: e.target.value })}
                  placeholder={settings.smtp?.has_pass ? '••••••••' : 'paste the app password'} autoComplete="new-password" /></div>
            )}
          </div>
          <div className="form-actions">
            <button className="btn gold" onClick={saveSmtp}>Save e-mail settings</button>
            <button className="btn" disabled={testing} onClick={testMail}>{testing ? 'Sending…' : '✉ Send test e-mail'}</button>
          </div>
        </details>

        {(() => {
          const td = tplDraft || settings.email_templates || {};
          const set = (k, v) => setTplDraft({ ...td, [k]: v });
          const blocks = [
            { sKey: 'nominee_subject', bKey: 'nominee_body', title: 'Nomination / assignment mail (to the employee)',
              ph: '{name} {kind} {verb} {training} {code} {dates} {mode} {slot} {how}' },
            { sKey: 'announce_subject', bKey: 'announce_body', title: 'Nominations-open invitation (to eligible employees)',
              ph: '{name} {training} {code} {dates} {mode} {deadline} {link}' },
          ];
          return (
            <details className="card scard setcard" style={{ marginBottom: 16 }}>
              <summary><span className="sicon">📝</span>E-mail templates
                {tplDraft && <span className="pill warn mini">unsaved changes</span>}
              </summary>
              <p className="muted mini" style={{ margin: '6px 0 10px' }}>
                Edit the wording; the {'{placeholders}'} are filled in automatically per mail, and the
                "Open the Learning Hub" button and footer are always added. A "Label: {'{value}'}" line whose
                value is empty is dropped from the mail.
              </p>
              {blocks.map((b) => (
                <div key={b.sKey} style={{ marginBottom: 14 }}>
                  <b style={{ fontSize: 13 }}>{b.title}</b>
                  <div className="muted" style={{ fontSize: 11, margin: '2px 0 6px' }}>Placeholders: {b.ph}</div>
                  <input style={{ width: '100%', marginBottom: 6 }} value={td[b.sKey] || ''}
                    placeholder="Subject" onChange={(e) => set(b.sKey, e.target.value)} />
                  <textarea rows={6} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }}
                    value={td[b.bKey] || ''} onChange={(e) => set(b.bKey, e.target.value)} />
                </div>
              ))}
              <div className="form-actions">
                <button className="btn gold" disabled={!tplDraft}
                  onClick={() => { save('email_templates', td, 'E-mail templates saved — used from the next mail onwards.'); setTplDraft(null); }}>
                  Save templates
                </button>
                {tplDraft && <button className="btn" onClick={() => setTplDraft(null)}>Discard changes</button>}
              </div>
            </details>
          );
        })()}
      </div>
    </>
  );
}

import React, { useState } from 'react';
import { api, ENTITIES, ENTITY_NAMES, inr } from '../api.js';
import { useSettings, useToast } from '../App.jsx';

const LISTS = [
  { key: 'divisions', label: 'Divisions', hint: 'Business lines shown on employees, assessments and filters.' },
  { key: 'departments', label: 'Departments', hint: 'Functions shown on employees and filters.' },
  { key: 'emp_types', label: 'Employment types', hint: 'Options in the employee form.' },
  { key: 'trn_categories', label: 'Training categories', hint: 'Options when planning a training.' },
  { key: 'exp_categories', label: 'Expense categories', hint: 'Cost heads on expense records.' },
  { key: 'joiner_steps', label: 'New-joiner checklist steps', hint: 'Tracked per joiner on the New Joiners tab.' },
];

// Optional employee-form fields an admin can promote to mandatory.
const EMP_FIELDS = [
  ['zoho_emp_id', 'Zoho employee ID'], ['email', 'Official e-mail'], ['mobile', 'Mobile'],
  ['division', 'Division'], ['department', 'Department'], ['designation', 'Designation'],
  ['manager', 'Reporting manager'], ['date_joined', 'Date of joining'], ['location', 'Location'],
];

export default function Settings() {
  const { settings, reloadSettings } = useSettings();
  const toast = useToast();
  const [newItem, setNewItem] = useState({});
  const [err, setErr] = useState(null);

  if (!settings) return <p className="muted">Loading…</p>;

  const save = async (key, value, msg) => {
    setErr(null);
    try {
      await api.put('/api/settings/' + key, { value });
      reloadSettings();
      toast(msg || 'Setting saved — applies across the application immediately.');
    } catch (e) { setErr(e.message); }
  };

  const req = settings.required_employee_fields || [];

  return (
    <>
      <div className="page-head"><h2>Settings</h2></div>
      <p className="muted" style={{ marginBottom: 16, fontSize: 13 }}>
        Customise the application without a code change. Every change is logged to the audit trail and applies immediately for everyone.
      </p>
      {err && <p className="err">{err}</p>}

      <div className="cols2">
        {LISTS.map((l) => (
          <div key={l.key} className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 15 }}>{l.label}</h3>
            <p className="muted mini" style={{ margin: '4px 0 10px' }}>{l.hint}</p>
            {(settings[l.key] || []).map((item) => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 13, borderBottom: '1px dashed var(--line)' }}>
                <span style={{ flex: 1 }}>{item}</span>
                <button className="btn link" title="Remove"
                  onClick={() => save(l.key, settings[l.key].filter((x) => x !== item), `"${item}" removed from ${l.label}. Existing records keep their old value.`)}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input style={{ flex: 1 }} placeholder={`Add to ${l.label.toLowerCase()}…`} value={newItem[l.key] || ''}
                onChange={(e) => setNewItem({ ...newItem, [l.key]: e.target.value })} />
              <button className="btn" disabled={!(newItem[l.key] || '').trim()}
                onClick={() => {
                  const v = newItem[l.key].trim();
                  if ((settings[l.key] || []).includes(v)) return setErr(`"${v}" is already in ${l.label}.`);
                  save(l.key, [...(settings[l.key] || []), v], `"${v}" added to ${l.label}.`);
                  setNewItem({ ...newItem, [l.key]: '' });
                }}>+ Add</button>
            </div>
          </div>
        ))}

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15 }}>Mandatory employee fields</h3>
          <p className="muted mini" style={{ margin: '4px 0 10px' }}>
            Name and entity are always required; tick anything else that must be filled before an employee can be saved.
          </p>
          {EMP_FIELDS.map(([key, label]) => (
            <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={req.includes(key)}
                onChange={(e) => save('required_employee_fields',
                  e.target.checked ? [...req, key] : req.filter((x) => x !== key),
                  `"${label}" is ${e.target.checked ? 'now mandatory' : 'optional again'} on the employee form.`)} />
              {label}
            </label>
          ))}
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15 }}>Annual training budgets (₹, per entity)</h3>
          <p className="muted mini" style={{ margin: '4px 0 10px' }}>
            Drives the Budget vs actual table on Expenses and the dashboard spend tile.
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
          <p className="muted mini" style={{ marginTop: 8 }}>
            Total: ₹{inr(ENTITIES.reduce((a, e) => a + (Number(settings.entity_budgets?.[e]) || 0), 0))} per financial year.
          </p>
        </div>
      </div>
    </>
  );
}

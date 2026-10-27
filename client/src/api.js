// Thin fetch wrapper: JSON in/out, throws {message} on error responses.
async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    // Session gone (expired or access revoked) — back to the sign-in screen.
    window.location.href = '/login';
    throw new Error('Not signed in');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (url) => call('GET', url),
  post: (url, body) => call('POST', url, body),
  patch: (url, body) => call('PATCH', url, body),
  put: (url, body) => call('PUT', url, body),
  del: (url) => call('DELETE', url),
};

// Upload one or more files; resolves to [{id, name}] for attaching to records.
export const MAX_UPLOAD_MB = 15;
export async function apiUpload(fileList, url = '/api/files') {
  const files = [...fileList];
  const big = files.find((f) => f.size > MAX_UPLOAD_MB * 1024 * 1024);
  if (big) throw new Error(`"${big.name}" is ${(big.size / 1048576).toFixed(1)} MB — files can be at most ${MAX_UPLOAD_MB} MB. Please upload a smaller or compressed copy.`);
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  const res = await fetch(url, { method: 'POST', body: fd, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 413 without a JSON body comes from the web server in front of the app.
    const msg = data.error || (res.status === 413
      ? 'The upload is larger than the server currently accepts. Try a smaller or compressed file (or ask the administrator to raise the server upload limit).'
      : `Upload failed (${res.status})`);
    const e = new Error(msg); e.need_login = data.need_login; throw e;
  }
  return data;
}

export const ENTITIES = ['AMD', 'ASS', 'ATS'];

// Assessment grading bands: (marks ÷ max) × 100 → grade + colour.
export const GRADES = [
  { min: 80, label: 'Very Good', color: '#1a7f37' },
  { min: 60, label: 'Good', color: '#1f6feb' },
  { min: 50, label: 'Satisfactory', color: '#b58a00' },
  { min: 0, label: 'Training is Needed', color: '#c62828' },
];
export const gradeOf = (pct) => GRADES.find((g) => pct >= g.min) || GRADES[GRADES.length - 1];
// 'ASS' stays the internal code (DB constraints, existing rows); it is
// always DISPLAYED as ASSP.
export const entLabel = (e) => (e === 'ASS' ? 'ASSP' : e);

// Feedback questions are plain strings (1–5 rating) or {q, type:'text'}
// for open answers.
export const qText = (q) => (typeof q === 'string' ? q : (q && q.q) || '');
export const qIsText = (q) => Boolean(q && typeof q === 'object' && q.type === 'text');
export const qIsFile = (q) => Boolean(q && typeof q === 'object' && q.type === 'file');
// Render a feedback answer cell: number, text, or uploaded files.
export const fbAnswer = (v) => {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) return v;   // file list — caller renders links
  return v;
};
export const ENTITY_NAMES = {
  AMD: 'Avana Medical Devices',
  ASS: 'Avana Surgical Systems',
  ATS: 'Avana Technology Services',
};
export const ROLES = { super_admin: 'Super admin', admin: 'Admin', leader: 'Leader', manager: 'Manager', learner: 'Learner' };

// Canonical lists from the prototype spec — one source for forms and filters.
export const DIVISIONS = ['Sports Medicine', 'Dex & Bio', 'Endospine', 'Orthotics', 'Business Support'];
export const DEPARTMENTS = ['Accounts', 'Administration', 'Clinical Support', 'Commercial', 'Graphic Design',
  'Human Resource', 'IT', 'Marketing', 'Medical Education', 'Operations', 'Quality', 'Sales', 'SCM', 'Service'];
export const EMP_TYPES = ['Permanent', 'Trainee', 'Intern', 'Contract', 'Consultant'];
export const TRN_CATEGORIES = ['Induction', 'Product', 'Soft skill', 'Technical', 'Compliance', 'Safety', 'On-the-job'];
export const TRN_MODES = ['Classroom', 'Online', 'On-the-job', 'Field', 'External seminar'];
// Same rule as the server (mailer.isVirtual): which modes get joining instructions.
export const isVirtual = (mode) => /online|virtual|webinar|teams|zoom/i.test(String(mode || ''));
export const TRN_STATUSES = {
  planned: 'Planned', confirmed: 'Confirmed', in_progress: 'In progress',
  completed: 'Completed', postponed: 'Postponed', cancelled: 'Cancelled',
};
export const EXP_CATEGORIES = ['Food / Catering', 'Flight', 'Venue / Conference room', 'Accommodation',
  'Local Transportation', 'Train', 'Training materials', 'Printing', 'Others'];

// Formatting helpers (IST conventions from the checklist).
// Local-calendar YYYY-MM-DD. NEVER use toISOString() for calendar days:
// it converts to UTC, which in IST lands 5½ hours earlier — the previous day.
export const toISODay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '');
export const fmtRange = (days) => {
  if (!days || !days.length) return '—';
  if (days.length === 1) return fmtDate(days[0]);
  if (days.length > 3) return `${fmtDay(days[0])} → ${fmtDay(days[days.length - 1])} (${days.length} days)`;
  return days.map(fmtDay).join(', ');
};
export const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
export const statusPill = (s) => (s === 'completed' ? 'good' : s === 'cancelled' || s === 'postponed' ? 'crit' : 'soft');

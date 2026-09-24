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
export async function apiUpload(fileList) {
  const fd = new FormData();
  [...fileList].forEach((f) => fd.append('files', f));
  const res = await fetch('/api/files', { method: 'POST', body: fd, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
  return data;
}

export const ENTITIES = ['AMD', 'ASS', 'ATS'];
export const ENTITY_NAMES = {
  AMD: 'Avana Medical Devices',
  ASS: 'Avana Surgical Systems',
  ATS: 'Avana Technology Services',
};
export const ROLES = { super_admin: 'Super admin', admin: 'Admin', manager: 'Manager' };

// Canonical lists from the prototype spec — one source for forms and filters.
export const DIVISIONS = ['Sports Medicine', 'Dex & Bio', 'Endospine', 'Orthotics', 'Business Support'];
export const DEPARTMENTS = ['Accounts', 'Administration', 'Clinical Support', 'Commercial', 'Graphic Design',
  'Human Resource', 'IT', 'Marketing', 'Medical Education', 'Operations', 'Quality', 'Sales', 'SCM', 'Service'];
export const EMP_TYPES = ['Permanent', 'Trainee', 'Intern', 'Contract', 'Consultant'];
export const TRN_CATEGORIES = ['Induction', 'Product', 'Soft skill', 'Technical', 'Compliance', 'Safety', 'On-the-job'];
export const TRN_MODES = ['Classroom', 'Online', 'On-the-job', 'Field', 'External seminar'];
export const TRN_STATUSES = {
  planned: 'Planned', confirmed: 'Confirmed', in_progress: 'In progress',
  completed: 'Completed', postponed: 'Postponed', cancelled: 'Cancelled',
};
export const EXP_CATEGORIES = ['Food / Catering', 'Flight', 'Venue / Conference room', 'Accommodation',
  'Local Transportation', 'Train', 'Training materials', 'Printing', 'Others'];

// Formatting helpers (IST conventions from the checklist).
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

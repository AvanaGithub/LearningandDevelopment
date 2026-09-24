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
};

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

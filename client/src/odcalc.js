import { inr } from './api.js';

// Organization Development money rules — the single source for every OD
// screen and report, so the figures always agree:
//  * SPENT = sum of the expense lines' actual amounts. Nothing else.
//  * A line is tagged to one location, or Company-wide. Allocating a
//    company-wide line across locations only changes the location-wise
//    view; it is never added to the total again.
//  * Remaining = approved − spent; Variance = spent − approved (positive =
//    over budget). With no approved budget yet, the estimate is the basis.
//  * Paid comes from payments; Pending = spent − paid.

export const n = (v) => Number(v) || 0;
export const has = (v) => v !== null && v !== undefined && v !== '';
export const rs = (v) => '₹' + inr(v);
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const sum = (arr, f) => arr.reduce((s, x) => s + n(f(x)), 0);

export function summarize(ev) {
  const locs = ev.locations || [];
  const items = ev.items || [];
  const pays = ev.payments || [];
  const spent = sum(items, (i) => i.actual_amount);
  const companyItems = items.filter((i) => !i.location);
  const companySpent = sum(companyItems, (i) => i.actual_amount);
  const paid = sum(pays, (p) => p.amt);
  const estimated = n(ev.est_budget);
  const approved = has(ev.approved_budget) ? n(ev.approved_budget) : null;
  const requested = has(ev.requested_budget) ? n(ev.requested_budget) : null;
  const basis = approved ?? (estimated || null);
  const basisLabel = approved !== null ? 'approved' : 'estimated';

  const byLoc = locs.map((l) => {
    const direct = sum(items.filter((i) => i.location && same(i.location, l.location)), (i) => i.actual_amount);
    const allocated = companyItems.reduce((s, i) =>
      s + sum((i.allocations || []).filter((a) => same(a.location, l.location)), (a) => a.amount), 0);
    const paidHere = sum(pays.filter((p) => p.location && same(p.location, l.location)), (p) => p.amt);
    return { ...l, direct, allocated, total: direct + allocated, paid: paidHere };
  });
  const allocatedTotal = sum(byLoc, (l) => l.allocated);
  const people = n(ev.participants) || n(ev.employee_count);

  return {
    estimated, requested, approved, basis, basisLabel,
    spent, paid,
    pending: Math.max(0, spent - paid),
    overpaid: Math.max(0, paid - spent),
    remaining: basis !== null ? basis - spent : null,
    variance: basis !== null ? spent - basis : null,
    companySpent,
    locationSpent: spent - companySpent,
    unallocated: Math.max(0, companySpent - allocatedTotal),
    byLoc,
    locTotals: {
      headcount: sum(locs, (l) => l.headcount),
      est: sum(locs, (l) => l.est_budget),
      approved: sum(locs, (l) => l.approved_budget),
      direct: sum(byLoc, (l) => l.direct),
      allocated: allocatedTotal,
      total: sum(byLoc, (l) => l.total),
    },
    lines: {
      est: sum(items, (i) => i.est_amount),
      approved: sum(items, (i) => i.approved_amount),
      actual: spent,
    },
    perHead: people ? spent / people : null,
  };
}

// Expense lines grouped by category (across any set of events).
export function byCategory(events) {
  const g = {};
  for (const ev of events) {
    for (const i of ev.items || []) {
      const k = i.category || 'Uncategorised';
      const o = (g[k] = g[k] || { category: k, lines: 0, est: 0, approved: 0, actual: 0, company: 0 });
      o.lines++; o.est += n(i.est_amount); o.approved += n(i.approved_amount); o.actual += n(i.actual_amount);
      if (!i.location) o.company += n(i.actual_amount);
    }
  }
  return Object.values(g).sort((a, b) => b.actual - a.actual);
}

// Location-wise across events: budgets from the location rows, spend split
// into direct lines + allocated company-wide share; unallocated company-wide
// spend is reported on its own row so the grand total still equals SPENT.
export function byLocation(events) {
  const g = {};
  let unallocated = 0;
  for (const ev of events) {
    const s = summarize(ev);
    unallocated += s.unallocated;
    for (const l of s.byLoc) {
      const k = l.location.trim().toLowerCase();
      const o = (g[k] = g[k] || { location: l.location.trim(), events: 0, headcount: 0, est: 0, approved: 0, direct: 0, allocated: 0, paid: 0 });
      o.events++; o.headcount += n(l.headcount); o.est += n(l.est_budget); o.approved += n(l.approved_budget);
      o.direct += l.direct; o.allocated += l.allocated; o.paid += l.paid;
    }
  }
  const rows = Object.values(g).map((o) => ({ ...o, total: o.direct + o.allocated }))
    .sort((a, b) => b.total - a.total);
  return { rows, unallocated };
}

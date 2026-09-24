import * as XLSX from 'xlsx';

// Real .xlsx download with auto-sized columns.
export const toXlsx = (name, header, rows, sheet = 'Data') => {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = header.map((h, i) => ({
    wch: Math.min(40, Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length), 8) + 2),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, name);
};

// First sheet of an uploaded .xlsx/.csv as an array-of-arrays (formatted strings).
export const readSheet = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      resolve(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }));
    } catch (err) { reject(err); }
  };
  r.onerror = reject;
  r.readAsArrayBuffer(file);
});

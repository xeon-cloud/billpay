const crypto = require('crypto');
const { tx } = require('./db');
const { events: E } = require('./audit');

const MAX_SIZE = 10 * 1024 * 1024;
const URL_MAX = 2000;
const NAME_MAX = 100;
const TYPES = [
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }
];
const MIMES = TYPES.map((t) => t.mime);

const sniff = (buf) => TYPES.find((t) => t.test(buf)) || null;

function safeName(raw, ext) {
  let n = '';
  if (raw !== undefined && raw !== null && raw !== '') {
    try { n = decodeURIComponent(String(raw)); } catch { return null; }
  }
  n = n.replace(/^.*[\\/]/, '').replace(/[\u0000-\u001f\u007f-\u009f"<>:|?*\\/]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  const base = n.replace(/\.[^.\s]{1,8}$/, '').slice(0, NAME_MAX).trim() || 'чек';
  return `${base}.${ext}`;
}

function checkUrl(v) {
  if (typeof v !== 'string' || !v.trim()) return 'url: обязательно';
  const s = v.trim();
  if (s.length > URL_MAX) return `url: не длиннее ${URL_MAX} символов`;
  let u;
  try { u = new URL(s); } catch { return 'url: нужна полная ссылка http:// или https://'; }
  if (!['http:', 'https:'].includes(u.protocol)) return 'url: только http:// или https://';
  if (u.username || u.password) return 'url: без логина и пароля в ссылке';
  if (!u.hostname) return 'url: нужна полная ссылка http:// или https://';
  return null;
}

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

const COLS = `r.kind, r.url, r.filename, r.mime, r.size, r.created_at, r.created_login, coalesce(u.name, r.created_name) AS created_name`;
const RECEIPT_JSON = `(SELECT json_build_object('kind', r.kind, 'url', r.url, 'filename', r.filename, 'mime', r.mime, 'size', r.size, 'created_at', r.created_at, 'created_login', r.created_login, 'created_name', coalesce(u.name, r.created_name))
  FROM occurrence_receipts r LEFT JOIN users u ON u.id = r.created_by WHERE r.occurrence_id = payment_occurrences.id)`;

function receiptView(r) {
  if (!r) return null;
  const added_at = new Date(r.created_at).toISOString();
  const added_by = r.created_login ? { login: r.created_login, name: r.created_name || null } : null;
  if (r.kind === 'link') return { kind: 'link', url: r.url, host: hostOf(r.url), added_at, added_by };
  return { kind: 'file', name: r.filename, mime: r.mime, size: Number(r.size), added_at, added_by };
}

function createReceipts(pool) {
  async function get(occurrenceId) {
    const { rows } = await pool.query(`SELECT ${COLS} FROM occurrence_receipts r LEFT JOIN users u ON u.id = r.created_by WHERE r.occurrence_id = $1`, [occurrenceId]);
    return receiptView(rows[0]);
  }

  async function file(occurrenceId) {
    const { rows } = await pool.query('SELECT kind, filename, mime, size, data FROM occurrence_receipts WHERE occurrence_id = $1', [occurrenceId]);
    return rows[0] || null;
  }

  async function put(o, input, user, log = null) {
    return tx(pool, async (c) => {
      const { rows: [prev] } = await c.query('SELECT kind, url, filename, size FROM occurrence_receipts WHERE occurrence_id = $1 FOR UPDATE', [o.id]);
      const f = input.kind === 'file' ? input : null;
      const { rows: [row] } = await c.query(
        `INSERT INTO occurrence_receipts (occurrence_id, kind, url, filename, mime, size, sha256, data, created_by, created_login, created_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (occurrence_id) DO UPDATE SET kind = EXCLUDED.kind, url = EXCLUDED.url, filename = EXCLUDED.filename, mime = EXCLUDED.mime,
           size = EXCLUDED.size, sha256 = EXCLUDED.sha256, data = EXCLUDED.data, created_at = now(), created_by = EXCLUDED.created_by,
           created_login = EXCLUDED.created_login, created_name = EXCLUDED.created_name
         RETURNING kind, url, filename, mime, size, created_at, created_login, created_name`,
        [o.id, input.kind, f ? null : input.url, f ? f.name : null, f ? f.mime : null, f ? f.data.length : null,
          f ? crypto.createHash('sha256').update(f.data).digest('hex') : null, f ? f.data : null, user.id, user.login, user.name]
      );
      if (log) await log(c, prev ? E.receiptReplaced(o, prev, row) : E.receiptAdded(o, row));
      return { created: !prev, receipt: receiptView(row) };
    });
  }

  async function remove(o, log = null) {
    return tx(pool, async (c) => {
      const { rows: [prev] } = await c.query('DELETE FROM occurrence_receipts WHERE occurrence_id = $1 RETURNING kind, url, filename, size', [o.id]);
      if (prev && log) await log(c, E.receiptRemoved(o, prev));
      return !!prev;
    });
  }

  return { get, file, put, remove };
}

module.exports = { createReceipts, receiptView, RECEIPT_JSON, MAX_SIZE, MIMES, URL_MAX, sniff, safeName, checkUrl, hostOf };

// /api/notes.js
// Vercel serverless function — ders notları için basit CRUD API.
// Depolama: Vercel KV (Upstash Redis REST API'si üzerinden, "KV_REST_API_URL"
// ve "KV_REST_API_TOKEN" ortam değişkenleriyle). Bu iki değişken, Vercel
// projenize bir "KV" (Storage) veritabanı bağladığınızda otomatik eklenir.
//
// Kimlik doğrulama: her istek "x-admin-password" header'ında, Vercel'de
// tanımladığınız ADMIN_PASSWORD ortam değişkeniyle aynı şifreyi taşımalı.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const NOTES_KEY = 'ders_notlari';

async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) throw new Error('KV okuma hatası');
  const data = await res.json();
  if (!data.result) return [];
  try {
    return JSON.parse(data.result);
  } catch {
    return [];
  }
}

async function kvSet(key, value) {
  const res = await fetch(`${KV_URL}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error('KV yazma hatası');
}

function checkAuth(req) {
  const pw = req.headers['x-admin-password'];
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!KV_URL || !KV_TOKEN) {
    res.status(500).json({
      error:
        'KV veritabanı bağlı değil. Vercel projenizde bir KV (Storage) veritabanı oluşturup projeye bağlamanız gerekiyor.',
    });
    return;
  }

  if (!checkAuth(req)) {
    res.status(401).json({ error: 'Şifre hatalı veya eksik.' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const notes = await kvGet(NOTES_KEY);
      notes.sort((a, b) => b.updatedAt - a.updatedAt);
      res.status(200).json({ notes });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
      const { title, content, student, lessonDate } = body;
      if (!title || !content) {
        res.status(400).json({ error: 'Başlık ve not içeriği zorunlu.' });
        return;
      }
      const notes = await kvGet(NOTES_KEY);
      const now = Date.now();
      const note = {
        id: now.toString(36) + Math.random().toString(36).slice(2, 7),
        title,
        content,
        student: student || '',
        lessonDate: lessonDate || '',
        createdAt: now,
        updatedAt: now,
      };
      notes.push(note);
      await kvSet(NOTES_KEY, notes);
      res.status(201).json({ note });
      return;
    }

    if (req.method === 'PUT') {
      const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
      const { id, title, content, student, lessonDate } = body;
      if (!id) {
        res.status(400).json({ error: 'id zorunlu.' });
        return;
      }
      const notes = await kvGet(NOTES_KEY);
      const idx = notes.findIndex((n) => n.id === id);
      if (idx === -1) {
        res.status(404).json({ error: 'Not bulunamadı.' });
        return;
      }
      notes[idx] = {
        ...notes[idx],
        title: title ?? notes[idx].title,
        content: content ?? notes[idx].content,
        student: student ?? notes[idx].student,
        lessonDate: lessonDate ?? notes[idx].lessonDate,
        updatedAt: Date.now(),
      };
      await kvSet(NOTES_KEY, notes);
      res.status(200).json({ note: notes[idx] });
      return;
    }

    if (req.method === 'DELETE') {
      const id = (req.query && req.query.id) || '';
      if (!id) {
        res.status(400).json({ error: 'id zorunlu (?id=...).' });
        return;
      }
      const notes = await kvGet(NOTES_KEY);
      const filtered = notes.filter((n) => n.id !== id);
      await kvSet(NOTES_KEY, filtered);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Desteklenmeyen metod.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Sunucu hatası.' });
  }
};

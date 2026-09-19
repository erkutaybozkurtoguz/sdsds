// /api/files.js
// Ders materyali (PDF vb.) yükleme/listeleme/silme API'si.
// Dosyanın kendisi Vercel Blob'da saklanır. Blob store'u projeye bağladığınızda
// Vercel otomatik olarak BLOB_STORE_ID ekler ve kimlik doğrulamayı OIDC ile
// (VERCEL_OIDC_TOKEN, otomatik yenilenir) kendisi halleder — @vercel/blob SDK'sı
// bunu kendiliğinden kullanır, elle bir token girmenize gerek yok.
// Dosya listesi (ad, boyut, link) Vercel KV'de saklanır — notes.js ile aynı KV.

const { put, del, get } = require('@vercel/blob');

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const FILES_KEY = 'yuklenen_dosyalar';

// Base64 + JSON gövdesiyle gönderildiği için gerçek dosya boyutunu
// güvenli tarafta tutuyoruz (Vercel'in istek gövdesi sınırına takılmamak için).
const MAX_BYTES = 3 * 1024 * 1024; // 3MB

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

function fmtErr(err) {
  return err && err.message ? err.message : 'Sunucu hatası.';
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!KV_URL || !KV_TOKEN) {
    res.status(500).json({
      error: 'KV veritabanı bağlı değil. Vercel projenizde bir KV veritabanı oluşturup bağlamanız gerekiyor.',
    });
    return;
  }
  if (!process.env.BLOB_STORE_ID) {
    res.status(500).json({
      error:
        'Blob depolama bağlı değil. Vercel projenizde Storage → Blob'
        + ' üzerinden bir Blob veritabanı oluşturup projeye bağlamanız gerekiyor.',
    });
    return;
  }
  if (!checkAuth(req)) {
    res.status(401).json({ error: 'Şifre hatalı veya eksik.' });
    return;
  }

  try {
    if (req.method === 'GET' && req.query && req.query.download) {
      const pathname = req.query.download;
      const { stream, blob } = await get(pathname, { access: 'private' });
      var displayName = (blob.pathname || pathname).split('/').pop();
      res.setHeader('Content-Type', blob.contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="' + displayName.replace(/"/g, '') + '"');
      stream.pipe(res);
      return;
    }

    if (req.method === 'GET') {
      const files = await kvGet(FILES_KEY);
      files.sort((a, b) => b.uploadedAt - a.uploadedAt);
      res.status(200).json({ files });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
      const { name, mimeType, dataBase64 } = body;
      if (!name || !dataBase64) {
        res.status(400).json({ error: 'Dosya adı ve içeriği zorunlu.' });
        return;
      }

      const buffer = Buffer.from(dataBase64, 'base64');
      if (buffer.length > MAX_BYTES) {
        res.status(413).json({ error: 'Dosya çok büyük. En fazla 3MB yükleyebilirsiniz.' });
        return;
      }

      const blob = await put(`ders-materyalleri/${Date.now()}-${name}`, buffer, {
        access: 'private',
        contentType: mimeType || 'application/octet-stream',
        addRandomSuffix: true,
      });

      const files = await kvGet(FILES_KEY);
      const record = {
        id: blob.pathname,
        name,
        pathname: blob.pathname,
        size: buffer.length,
        mimeType: mimeType || '',
        uploadedAt: Date.now(),
      };
      files.push(record);
      await kvSet(FILES_KEY, files);

      res.status(201).json({ file: record });
      return;
    }

    if (req.method === 'DELETE') {
      const id = (req.query && req.query.id) || '';
      if (!id) {
        res.status(400).json({ error: 'id zorunlu (?id=...).' });
        return;
      }
      await del(id);
      const files = await kvGet(FILES_KEY);
      const filtered = files.filter((f) => f.id !== id);
      await kvSet(FILES_KEY, filtered);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Desteklenmeyen metod.' });
  } catch (err) {
    res.status(500).json({ error: fmtErr(err) });
  }
};

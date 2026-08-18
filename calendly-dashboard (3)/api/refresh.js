import { refreshCache } from './_calendly.js';

export default async function handler(req, res) {
  // Vercel Cron sends a special header; also allow a manual secret for testing
  const isVercelCron = req.headers['x-vercel-cron'] !== undefined;
  const providedSecret = req.query.secret;
  const expectedSecret = process.env.CRON_SECRET;

  if (!isVercelCron && (!expectedSecret || providedSecret !== expectedSecret)) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  try {
    const events = await refreshCache();
    return res.status(200).json({ ok: true, count: events.length, refreshedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

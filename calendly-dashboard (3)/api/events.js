import { getCache, refreshCache } from './_calendly.js';

export default async function handler(req, res) {
  const cache = getCache();

  if (cache.data) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('X-Cache-Age-Seconds', Math.round((Date.now() - cache.timestamp) / 1000));
    return res.status(200).json({ events: cache.data });
  }

  // Cache empty (e.g. cold start before the first cron run) — fetch once so the dashboard isn't stuck
  try {
    const events = await refreshCache();
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({ events });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

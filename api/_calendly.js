// Shared in-memory cache + fetch logic, used by both the cron refresher and the read endpoint.
let cache = { data: null, timestamp: 0 };

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(runners);
  return results;
}

export async function refreshCache() {
  const token = process.env.CALENDLY_TOKEN;
  if (!token) {
    throw new Error('CALENDLY_TOKEN no está configurado en el servidor.');
  }

  const meRes = await fetch('https://api.calendly.com/users/me', {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!meRes.ok) {
    throw new Error('Token inválido o sin permisos.');
  }
  const me = await meRes.json();
  const organizationUri = me.resource.current_organization;

  const params = new URLSearchParams({
    organization: organizationUri,
    count: '100',
    sort: 'start_time:desc'
  });

  let events = [];
  let url = 'https://api.calendly.com/scheduled_events?' + params.toString();
  let pageCount = 0;
  while (url && pageCount < 20) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) {
      throw new Error('Error al obtener eventos de Calendly.');
    }
    const data = await r.json();
    events = events.concat(data.collection);
    url = data.pagination && data.pagination.next_page ? data.pagination.next_page : null;
    pageCount++;
  }

  const userCache = {};
  async function getUserName(userUri) {
    if (!userUri) return '—';
    if (userCache[userUri]) return userCache[userUri];
    try {
      const r = await fetch(userUri, { headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) {
        const d = await r.json();
        const name = d.resource.name || d.resource.email || userUri;
        userCache[userUri] = name;
        return name;
      }
    } catch (e) {}
    return '—';
  }

  const uniqueHostUris = [...new Set(
    events.flatMap(ev => (ev.event_memberships || []).map(m => m.user)).filter(Boolean)
  )];
  await mapWithConcurrency(uniqueHostUris, 10, (uri) => getUserName(uri));

  const enriched = await mapWithConcurrency(events, 10, async (ev) => {
    let inviteeName = '—', inviteeEmail = '', inviteeTimezone = '', questionsAndAnswers = [], textReminderNumber = '', cancelReason = '', rescheduled = false;
    try {
      const invRes = await fetch(ev.uri + '/invitees', { headers: { Authorization: 'Bearer ' + token } });
      if (invRes.ok) {
        const invData = await invRes.json();
        if (invData.collection && invData.collection.length > 0) {
          const inv = invData.collection[0];
          inviteeName = inv.name || inv.email;
          inviteeEmail = inv.email || '';
          inviteeTimezone = inv.timezone || '';
          questionsAndAnswers = inv.questions_and_answers || [];
          textReminderNumber = inv.text_reminder_number || '';
          cancelReason = inv.cancellation ? inv.cancellation.reason : '';
          rescheduled = inv.rescheduled || false;
        }
      }
    } catch (e) {}

    let locationInfo = '';
    if (ev.location) {
      if (typeof ev.location === 'string') locationInfo = ev.location;
      else locationInfo = ev.location.location || ev.location.join_url || ev.location.type || '';
    }

    const hosts = (ev.event_memberships || []).map(m => userCache[m.user] || '—');

    return {
      type: ev.name || 'Sin nombre',
      start: ev.start_time,
      end: ev.end_time,
      status: ev.status,
      invitee: inviteeName,
      email: inviteeEmail,
      timezone: inviteeTimezone,
      location: locationInfo,
      hosts,
      questionsAndAnswers,
      textReminderNumber,
      cancelReason,
      rescheduled,
      eventUri: ev.uri,
      createdAt: ev.created_at,
      updatedAt: ev.updated_at
    };
  });

  cache = { data: enriched, timestamp: Date.now() };
  return enriched;
}

export function getCache() {
  return cache;
}

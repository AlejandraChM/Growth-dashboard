// Shared in-memory cache + fetch logic, used by both the cron refresher and the read endpoint.
let cache = { data: null, timestamp: 0, debug: null };

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

async function fetchAllPages(url, token) {
  let items = [];
  let nextUrl = url;
  let pageCount = 0;
  while (nextUrl && pageCount < 30) {
    const r = await fetch(nextUrl, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) {
      throw new Error('Error al consultar Calendly (' + r.status + ').');
    }
    const data = await r.json();
    items = items.concat(data.collection);
    nextUrl = data.pagination && data.pagination.next_page ? data.pagination.next_page : null;
    pageCount++;
  }
  return items;
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

  // Fetch events across ALL active event types individually and merge.
  // This is more reliable than a single paginated org-wide sweep, because it guarantees
  // low-volume event types (like "First Interview") aren't crowded out by high-volume ones
  // (like "Onboarding Session") when both share the same recency-sorted page window.
  const eventTypesUrl = 'https://api.calendly.com/event_types?organization=' + encodeURIComponent(organizationUri) + '&count=100';
  const eventTypes = await fetchAllPages(eventTypesUrl, token);

  let events = [];
  const perTypeLog = [];
  for (const et of eventTypes) {
    const params = new URLSearchParams({
      organization: organizationUri,
      event_type: et.uri,
      count: '100',
      sort: 'start_time:desc'
    });
    const url = 'https://api.calendly.com/scheduled_events?' + params.toString();
    const typeEvents = await fetchAllPages(url, token);
    events = events.concat(typeEvents);
    perTypeLog.push({ name: et.name, uri: et.uri, count: typeEvents.length });
  }

  const debugInfo = {
    organizationUri,
    eventTypesFound: eventTypes.map(et => et.name),
    totalEventsFetched: events.length,
    perTypeLog
  };

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

  cache = { data: enriched, timestamp: Date.now(), debug: debugInfo };
  return enriched;
}

export function getCache() {
  return cache;
}

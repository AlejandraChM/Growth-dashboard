export default async function handler(req, res) {
  const token = process.env.CALENDLY_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'CALENDLY_TOKEN no está configurado en el servidor.' });
  }

  try {
    const meRes = await fetch('https://api.calendly.com/users/me', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!meRes.ok) {
      return res.status(meRes.status).json({ error: 'Token inválido o sin permisos.' });
    }
    const me = await meRes.json();
    const userUri = me.resource.uri;

    const params = new URLSearchParams({
      user: userUri,
      count: '100',
      sort: 'start_time:desc'
    });

    let events = [];
    let url = 'https://api.calendly.com/scheduled_events?' + params.toString();
    let pageCount = 0;
    while (url && pageCount < 20) {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) {
        return res.status(r.status).json({ error: 'Error al obtener eventos de Calendly.' });
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
          userCache[userUri] = d.resource.name || d.resource.email || userUri;
          return userCache[userUri];
        }
      } catch (e) {}
      return '—';
    }

    const enriched = [];
    for (const ev of events) {
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

      let hosts = [];
      if (ev.event_memberships && ev.event_memberships.length > 0) {
        for (const mem of ev.event_memberships) {
          const name = await getUserName(mem.user);
          hosts.push(name);
        }
      }

      enriched.push({
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
      });
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ events: enriched });
  } catch (err) {
    return res.status(500).json({ error: 'Error inesperado: ' + err.message });
  }
}

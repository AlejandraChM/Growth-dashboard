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

    const { minDate, maxDate } = req.query;
    const params = new URLSearchParams({
      user: userUri,
      count: '100',
      sort: 'start_time:desc'
    });
    if (minDate) params.set('min_start_time', new Date(minDate).toISOString());
    if (maxDate) params.set('max_start_time', new Date(maxDate + 'T23:59:59').toISOString());

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

    const enriched = [];
    for (const ev of events) {
      let inviteeName = '—', inviteeEmail = '';
      try {
        const invRes = await fetch(ev.uri + '/invitees', { headers: { Authorization: 'Bearer ' + token } });
        if (invRes.ok) {
          const invData = await invRes.json();
          if (invData.collection && invData.collection.length > 0) {
            inviteeName = invData.collection[0].name || invData.collection[0].email;
            inviteeEmail = invData.collection[0].email || '';
          }
        }
      } catch (e) {}
      enriched.push({
        type: ev.name || 'Sin nombre',
        start: ev.start_time,
        status: ev.status,
        invitee: inviteeName,
        email: inviteeEmail
      });
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ events: enriched });
  } catch (err) {
    return res.status(500).json({ error: 'Error inesperado: ' + err.message });
  }
}

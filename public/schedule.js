const els = {
  notConnected: document.getElementById('youtube-not-connected'),
  connected: document.getElementById('youtube-connected'),
  channelName: document.getElementById('yt-channel-name'),
  clientId: document.getElementById('yt-client-id'),
  clientSecret: document.getElementById('yt-client-secret'),
  saveCredentialsBtn: document.getElementById('yt-save-credentials-btn'),
  disconnectBtn: document.getElementById('yt-disconnect-btn'),
  statusMessage: document.getElementById('youtube-status-message'),
  unscheduledList: document.getElementById('unscheduled-list'),
  unscheduledEmpty: document.getElementById('unscheduled-empty'),
  calGrid: document.getElementById('calendar-grid'),
  calRangeLabel: document.getElementById('cal-range-label'),
  calPrevBtn: document.getElementById('cal-prev-btn'),
  calNextBtn: document.getElementById('cal-next-btn'),
  calTodayBtn: document.getElementById('cal-today-btn')
};

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 06:00 - 23:00
const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

let videos = [];
let weekStart = getMonday(new Date());

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request fehlgeschlagen (${res.status})`);
  return body;
}

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d, n) {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

function fmtDateLabel(d) {
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function fmtRangeLabel(start) {
  const end = addDays(start, 6);
  return `${fmtDateLabel(start)} – ${fmtDateLabel(end)} ${end.getFullYear()}`;
}

function fmtTime(d) {
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// ---- YouTube-Verbindung ----

async function loadYoutubeStatus() {
  const status = await fetchJson('/api/youtube/status');
  if (status.connected) {
    els.notConnected.hidden = true;
    els.connected.hidden = false;
    // Der Upload-Scope erlaubt keinen Lesezugriff auf Kanaldaten -- ein
    // fehlender Name ist daher normal und kein Verbindungsproblem.
    els.channelName.textContent = status.channelTitle || '(Kanalname nicht abrufbar – Upload-Berechtigung ist aktiv)';
  } else {
    els.notConnected.hidden = false;
    els.connected.hidden = true;
    if (status.configured) {
      els.clientId.placeholder = 'Client-ID (bereits hinterlegt) – neu eingeben zum Ändern';
      els.clientSecret.placeholder = 'Client-Secret (bereits hinterlegt) – neu eingeben zum Ändern';
    }
  }
  if (status.error) {
    els.statusMessage.textContent = `Hinweis: ${status.error}`;
  }
}

els.saveCredentialsBtn.addEventListener('click', async () => {
  const clientId = els.clientId.value.trim();
  const clientSecret = els.clientSecret.value.trim();
  if (!clientId || !clientSecret) {
    els.statusMessage.textContent = 'Bitte Client-ID und Client-Secret eintragen.';
    return;
  }
  try {
    await fetchJson('/api/youtube/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret })
    });
    els.statusMessage.textContent = 'Gespeichert. Jetzt auf "Mit YouTube verbinden" klicken.';
  } catch (err) {
    els.statusMessage.textContent = `Fehler: ${err.message}`;
  }
});

els.disconnectBtn.addEventListener('click', async () => {
  await fetchJson('/api/youtube/disconnect', { method: 'POST' });
  await loadYoutubeStatus();
});

function handleOAuthRedirectMessage() {
  const params = new URLSearchParams(window.location.search);
  const authResult = params.get('youtube_auth');
  if (authResult === 'success') {
    els.statusMessage.textContent = 'Erfolgreich mit YouTube verbunden!';
  } else if (authResult === 'error') {
    els.statusMessage.textContent = `Verbindung fehlgeschlagen: ${params.get('message') || 'unbekannter Fehler'}`;
  }
  if (authResult) {
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// ---- Video-Bibliothek ----

let lastVideosJson = '';

// Nach einer expliziten Nutzeraktion (einplanen, loeschen, ...) IMMER sofort
// neu rendern -- der Nutzer erwartet direktes Feedback.
async function loadVideos() {
  videos = await fetchJson('/api/videos');
  lastVideosJson = JSON.stringify(videos);
  renderUnscheduled();
  renderCalendar();
}

// Wird alle paar Sekunden im Hintergrund gepollt (fuer Upload-Status-Updates
// anderer Videos). Ein bedingungsloses Neu-Rendern wuerde dabei offene
// Eingabefelder (Titel, Beschreibung, Tags) mitten im Tippen zerstoeren --
// daher nur neu rendern, wenn sich die Daten wirklich geaendert haben, und
// dann auch nur, wenn der Nutzer nicht gerade in einem Formularfeld der
// Bibliothek/des Kalenders tippt (Aenderung wird beim naechsten Poll
// nachgeholt, sobald das Feld den Fokus verliert).
async function pollVideos() {
  let data;
  try {
    data = await fetchJson('/api/videos');
  } catch {
    return; // Server kurz nicht erreichbar -> naechster Poll
  }
  videos = data;

  const json = JSON.stringify(data);
  if (json === lastVideosJson) return;
  lastVideosJson = json;

  const active = document.activeElement;
  const isEditing = active
    && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
    && (els.unscheduledList.contains(active) || els.calGrid.contains(active));
  if (isEditing) return;

  renderUnscheduled();
  renderCalendar();
}

function statusBadge(video) {
  switch (video.uploadStatus) {
    case 'uploading': return '⏳ lädt hoch …';
    case 'scheduled_on_youtube': return '✅ auf YouTube geplant';
    case 'error': return `❌ Fehler: ${video.error || 'unbekannt'}`;
    default: return '';
  }
}

function buildVideoCard(video, { compact } = {}) {
  const card = document.createElement('div');
  card.className = 'video-card' + (compact ? ' compact' : '');
  card.dataset.id = video.id;

  const draggable = video.uploadStatus !== 'uploading' && video.uploadStatus !== 'scheduled_on_youtube';
  card.draggable = draggable;
  if (draggable) {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', video.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  }

  if (video.thumbnailPath) {
    const thumb = document.createElement('img');
    thumb.className = 'video-card-thumb';
    thumb.src = `/${video.thumbnailPath}`;
    thumb.alt = '';
    card.appendChild(thumb);
  }

  const body = document.createElement('div');
  body.className = 'video-card-body';

  if (compact) {
    const title = document.createElement('div');
    title.className = 'video-card-title-compact';
    title.textContent = video.youtubeTitle || '(ohne Titel)';
    body.appendChild(title);

    const time = document.createElement('div');
    time.className = 'video-card-time';
    time.textContent = video.scheduledAt ? fmtTime(new Date(video.scheduledAt)) : '';
    time.title = 'Klicken, um Uhrzeit zu ändern';
    if (draggable) {
      time.style.cursor = 'pointer';
      time.addEventListener('click', () => editScheduledTime(video));
    }
    body.appendChild(time);

    const status = document.createElement('div');
    status.className = 'video-card-status';
    status.textContent = statusBadge(video);
    body.appendChild(status);

    if (draggable) {
      const unscheduleBtn = document.createElement('button');
      unscheduleBtn.type = 'button';
      unscheduleBtn.className = 'video-card-unschedule';
      unscheduleBtn.textContent = 'Zurück';
      unscheduleBtn.addEventListener('click', () => unscheduleVideo(video.id));
      body.appendChild(unscheduleBtn);
    }
  } else {
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'YouTube-Titel (erforderlich zum Planen)';
    titleInput.value = video.youtubeTitle || '';
    titleInput.addEventListener('change', () => updateVideoField(video.id, { youtubeTitle: titleInput.value }));
    body.appendChild(titleInput);

    const descInput = document.createElement('textarea');
    descInput.rows = 2;
    descInput.placeholder = 'Beschreibung';
    descInput.value = video.youtubeDescription || '';
    descInput.addEventListener('change', () => updateVideoField(video.id, { youtubeDescription: descInput.value }));
    body.appendChild(descInput);

    const tagsInput = document.createElement('input');
    tagsInput.type = 'text';
    tagsInput.placeholder = 'Tags/Hashtags, kommagetrennt (z.B. ranking, shorts, fails)';
    tagsInput.value = (video.tags || []).join(', ');
    tagsInput.addEventListener('change', () => {
      const tags = tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean);
      updateVideoField(video.id, { tags });
    });
    body.appendChild(tagsInput);

    const kidsRow = document.createElement('label');
    kidsRow.className = 'kids-row';
    const kidsCheckbox = document.createElement('input');
    kidsCheckbox.type = 'checkbox';
    kidsCheckbox.checked = !!video.madeForKids;
    kidsCheckbox.addEventListener('change', () => updateVideoField(video.id, { madeForKids: kidsCheckbox.checked }));
    kidsRow.appendChild(kidsCheckbox);
    kidsRow.appendChild(document.createTextNode(' Für Kinder gemacht ("Made for Kids")'));
    body.appendChild(kidsRow);

    const meta = document.createElement('div');
    meta.className = 'video-card-meta hint';
    meta.textContent = 'Auf einen Kalender-Slot ziehen, um einzuplanen.';
    body.appendChild(meta);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'video-card-delete';
    deleteBtn.textContent = 'Löschen';
    deleteBtn.addEventListener('click', () => deleteVideo(video.id));
    body.appendChild(deleteBtn);
  }

  card.appendChild(body);
  return card;
}

function renderUnscheduled() {
  const unscheduled = videos.filter((v) => !v.scheduledAt);
  els.unscheduledList.innerHTML = '';
  els.unscheduledEmpty.hidden = unscheduled.length > 0;
  for (const video of unscheduled) {
    els.unscheduledList.appendChild(buildVideoCard(video));
  }
}

async function updateVideoField(id, patch) {
  await fetchJson(`/api/videos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
}

async function deleteVideo(id) {
  if (!confirm('Video wirklich löschen? Die gerenderte Videodatei wird dabei endgültig entfernt.')) return;
  try {
    await fetchJson(`/api/videos/${id}`, { method: 'DELETE' });
  } catch (err) {
    alert(`Konnte nicht gelöscht werden: ${err.message}`);
  }
  await loadVideos();
}

async function scheduleVideo(id, isoDatetime) {
  try {
    await fetchJson(`/api/videos/${id}/schedule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt: isoDatetime })
    });
  } catch (err) {
    alert(`Konnte nicht eingeplant werden: ${err.message}`);
  }
  await loadVideos();
}

async function unscheduleVideo(id) {
  try {
    await fetchJson(`/api/videos/${id}/unschedule`, { method: 'PUT' });
  } catch (err) {
    alert(`Konnte nicht zurückgenommen werden: ${err.message}`);
  }
  await loadVideos();
}

function editScheduledTime(video) {
  const current = new Date(video.scheduledAt);
  const pad = (n) => String(n).padStart(2, '0');
  const defaultValue = `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}T${pad(current.getHours())}:${pad(current.getMinutes())}`;
  const input = prompt('Neue Uhrzeit (JJJJ-MM-TTTHH:MM):', defaultValue);
  if (!input) return;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    alert('Ungültiges Datum/Uhrzeit.');
    return;
  }
  scheduleVideo(video.id, parsed.toISOString());
}

// ---- Kalender ----

function renderCalendar() {
  els.calRangeLabel.textContent = fmtRangeLabel(weekStart);
  els.calGrid.innerHTML = '';
  els.calGrid.style.setProperty('--day-count', 7);

  // Kopfzeile: leere Ecke + 7 Tagesueberschriften
  const corner = document.createElement('div');
  corner.className = 'cal-corner';
  els.calGrid.appendChild(corner);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  days.forEach((day, i) => {
    const head = document.createElement('div');
    head.className = 'cal-day-head';
    if (day.getTime() === today.getTime()) head.classList.add('is-today');
    head.textContent = `${DAY_LABELS[i]} ${fmtDateLabel(day)}`;
    els.calGrid.appendChild(head);
  });

  for (const hour of HOURS) {
    const hourLabel = document.createElement('div');
    hourLabel.className = 'cal-hour-label';
    hourLabel.textContent = `${String(hour).padStart(2, '0')}:00`;
    els.calGrid.appendChild(hourLabel);

    days.forEach((day, dayIndex) => {
      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      cell.dataset.dayIndex = String(dayIndex);
      cell.dataset.hour = String(hour);

      cell.addEventListener('dragover', (e) => {
        e.preventDefault();
        cell.classList.add('drag-over');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        if (!id) return;
        const slotDate = addDays(weekStart, dayIndex);
        slotDate.setHours(hour, 0, 0, 0);
        scheduleVideo(id, slotDate.toISOString());
      });

      els.calGrid.appendChild(cell);
    });
  }

  // Geplante Videos dieser Woche in ihre Zelle einsortieren.
  const weekEnd = addDays(weekStart, 7);
  for (const video of videos) {
    if (!video.scheduledAt) continue;
    const scheduled = new Date(video.scheduledAt);
    if (scheduled < weekStart || scheduled >= weekEnd) continue;

    // Zeiten vor 06:00 (per Klick auf die Uhrzeit einstellbar) haben keine
    // eigene Zeile -- in der ersten Zeile anzeigen statt das Video unsichtbar
    // zu machen (es stuende sonst weder im Kalender noch in der Bibliothek).
    // Die Karte zeigt weiterhin die echte Uhrzeit.
    const rowHour = Math.max(scheduled.getHours(), HOURS[0]);
    // round statt floor: an Tagen mit Zeitumstellung ist ein Tag 23/25 h lang.
    const dayIndex = Math.round((new Date(scheduled).setHours(0, 0, 0, 0) - weekStart.getTime()) / 86400000);
    const cell = els.calGrid.querySelector(`.cal-cell[data-day-index="${dayIndex}"][data-hour="${rowHour}"]`);
    if (cell) cell.appendChild(buildVideoCard(video, { compact: true }));
  }
}

els.calPrevBtn.addEventListener('click', () => {
  weekStart = addDays(weekStart, -7);
  renderCalendar();
});
els.calNextBtn.addEventListener('click', () => {
  weekStart = addDays(weekStart, 7);
  renderCalendar();
});
els.calTodayBtn.addEventListener('click', () => {
  weekStart = getMonday(new Date());
  renderCalendar();
});

async function init() {
  handleOAuthRedirectMessage();
  await loadYoutubeStatus();
  await loadVideos();
  setInterval(pollVideos, 5000); // Upload-Status im Blick behalten
}

init();

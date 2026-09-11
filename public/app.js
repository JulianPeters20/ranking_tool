const linksEl = document.getElementById('links');
const addBtn = document.getElementById('add-clips-btn');
const addErrorEl = document.getElementById('add-clips-error');
const listEl = document.getElementById('clip-list');
const listEmptyEl = document.getElementById('clip-list-empty');
const renderBtn = document.getElementById('render-btn');
const renderStatusEl = document.getElementById('render-status');
const renderResultEl = document.getElementById('render-result');
const renderVideoEl = document.getElementById('render-video');
const renderDownloadEl = document.getElementById('render-download');
const overallTitleEl = document.getElementById('overall-title');
const titleWordEditorEl = document.getElementById('title-word-editor');
const titleFontEl = document.getElementById('title-font');
const titleSizeEl = document.getElementById('title-size');

let clips = [];
let lastClipsJson = '';
let pollTimer = null;
let titleWordColors = {};

// Laufende Speicher-Requests (Titel, Rang, Trim, Einstellungen). Ein gerade
// verlassenes Eingabefeld speichert erst beim Klick auf "Video rendern" (via
// 'change') -- ohne Warten koennte der Render-Request den Server zuerst
// erreichen und mit dem alten Wert rendern.
const pendingSaves = new Set();

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request fehlgeschlagen (${res.status})`);
  }
  return body;
}

function sendJson(url, method, body) {
  const promise = fetchJson(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  pendingSaves.add(promise);
  promise.finally(() => pendingSaves.delete(promise)).catch(() => {});
  return promise;
}

function setClips(data) {
  clips = data;
  lastClipsJson = JSON.stringify(data);
  renderList();
}

// Uebernimmt einen einzelnen vom Server zurueckgegebenen Clip, ohne die Liste
// neu aufzubauen (sonst schliesst sich z.B. die offene Videovorschau).
function applyClipUpdate(updated) {
  const idx = clips.findIndex((c) => c.id === updated.id);
  if (idx === -1) return;
  clips[idx] = updated;
  lastClipsJson = JSON.stringify(clips);
}

async function loadClips() {
  setClips(await fetchJson('/api/clips'));
  scheduleFollowUpPollIfNeeded();
}

// Ein Neuaufbau der Liste zerstoert ein fokussiertes Eingabefeld (Tippen geht
// verloren), eine offene Videovorschau und einen laufenden Drag. Der
// Hintergrund-Poll rendert daher nur, wenn der Nutzer gerade nichts davon
// tut -- verpasste Aenderungen holt der naechste Poll nach.
function isUserBusyWithList() {
  if (listEl.querySelector('.dragging')) return true;
  if (listEl.querySelector('.preview-wrap:not([hidden])')) return true;
  const active = document.activeElement;
  return !!active && listEl.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
}

async function pollClips() {
  let data;
  try {
    data = await fetchJson('/api/clips');
  } catch {
    return; // Server kurz nicht erreichbar -> naechster Versuch
  }
  const json = JSON.stringify(data);
  if (json !== lastClipsJson && !isUserBusyWithList()) {
    setClips(data);
  }
  const upToDate = json === lastClipsJson;
  if (upToDate && !data.some((c) => c.status === 'downloading')) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function scheduleFollowUpPollIfNeeded() {
  const stillDownloading = clips.some((c) => c.status === 'downloading');
  if (stillDownloading && !pollTimer) {
    pollTimer = setInterval(pollClips, 1500);
  }
}

function statusLabel(clip) {
  if (clip.status === 'downloading') return 'Lädt herunter …';
  if (clip.status === 'error') return `Fehler: ${clip.error || 'unbekannt'}`;
  if (typeof clip.duration === 'number') return `${clip.duration.toFixed(1)}s`;
  return '';
}

// Baut Trim-Zeile (Start/Ende in Sekunden) + einklappbare Videovorschau mit
// "Start/Ende hier setzen"-Buttons, die den aktuellen Wiedergabezeitpunkt
// des Vorschau-Players uebernehmen -- so muss man Zeiten nicht per Auge auf
// der Fortschrittsleiste ablesen und von Hand eintippen.
function buildClipControls(clip) {
  const container = document.createElement('div');
  container.className = 'clip-controls';

  const maxDuration = typeof clip.duration === 'number' ? clip.duration : undefined;

  const row = document.createElement('div');
  row.className = 'trim-row';

  const startLabel = document.createElement('span');
  startLabel.textContent = 'Start';
  const startInput = document.createElement('input');
  startInput.type = 'number';
  startInput.className = 'trim-input';
  startInput.min = '0';
  startInput.step = '0.1';
  if (maxDuration !== undefined) startInput.max = String(maxDuration);
  startInput.value = clip.trimStart || 0;

  const endLabel = document.createElement('span');
  endLabel.textContent = 'Ende';
  const endInput = document.createElement('input');
  endInput.type = 'number';
  endInput.className = 'trim-input';
  endInput.min = '0';
  endInput.step = '0.1';
  if (maxDuration !== undefined) endInput.max = String(maxDuration);
  endInput.value = clip.trimEnd ?? maxDuration ?? '';
  endInput.placeholder = maxDuration !== undefined ? maxDuration.toFixed(1) : '';

  const secLabel1 = document.createElement('span');
  secLabel1.className = 'trim-unit';
  secLabel1.textContent = 's';
  const secLabel2 = document.createElement('span');
  secLabel2.className = 'trim-unit';
  secLabel2.textContent = 's';

  // Kein Neuaufbau der Liste nach dem Speichern -- sonst wuerde sich die
  // Vorschau nach "Start hier setzen" schliessen, bevor man das Ende setzt.
  // Nur die (ggf. geclampten) gespeicherten Werte zurueck in die Felder.
  const commit = async () => {
    const updated = await updateTrim(clip.id, startInput.value, endInput.value, maxDuration);
    if (!updated) return;
    startInput.value = updated.trimStart;
    endInput.value = updated.trimEnd ?? maxDuration ?? '';
  };
  startInput.addEventListener('change', commit);
  endInput.addEventListener('change', commit);

  const previewToggleBtn = document.createElement('button');
  previewToggleBtn.type = 'button';
  previewToggleBtn.className = 'preview-toggle-btn';
  previewToggleBtn.textContent = 'Vorschau';

  row.appendChild(startLabel);
  row.appendChild(startInput);
  row.appendChild(secLabel1);
  row.appendChild(endLabel);
  row.appendChild(endInput);
  row.appendChild(secLabel2);
  row.appendChild(previewToggleBtn);
  container.appendChild(row);

  const previewWrap = document.createElement('div');
  previewWrap.className = 'preview-wrap';
  previewWrap.hidden = true;

  const video = document.createElement('video');
  video.controls = true;
  video.className = 'preview-video';
  video.preload = 'none';

  const previewActions = document.createElement('div');
  previewActions.className = 'preview-actions';

  const setStartBtn = document.createElement('button');
  setStartBtn.type = 'button';
  setStartBtn.textContent = 'Start hier setzen';
  setStartBtn.addEventListener('click', () => {
    startInput.value = video.currentTime.toFixed(1);
    commit();
  });

  const setEndBtn = document.createElement('button');
  setEndBtn.type = 'button';
  setEndBtn.textContent = 'Ende hier setzen';
  setEndBtn.addEventListener('click', () => {
    endInput.value = video.currentTime.toFixed(1);
    commit();
  });

  previewActions.appendChild(setStartBtn);
  previewActions.appendChild(setEndBtn);
  previewWrap.appendChild(video);
  previewWrap.appendChild(previewActions);
  container.appendChild(previewWrap);

  previewToggleBtn.addEventListener('click', () => {
    const opening = previewWrap.hidden;
    previewWrap.hidden = !opening;
    if (opening) {
      if (!video.src) video.src = `/${clip.filePath}`;
    } else {
      video.pause();
    }
  });

  return container;
}

function renderList() {
  listEl.innerHTML = '';
  listEmptyEl.hidden = clips.length > 0;

  for (const clip of clips) {
    const li = document.createElement('li');
    li.className = 'clip-card';
    li.dataset.id = clip.id;

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.title = 'Ziehen, um die Reihenfolge zu ändern';
    li.appendChild(handle);

    const rankWrap = document.createElement('div');
    rankWrap.className = 'rank-badge';
    const rankPrefix = document.createElement('span');
    rankPrefix.className = 'rank-prefix';
    rankPrefix.textContent = '#';
    const rankInput = document.createElement('input');
    rankInput.type = 'number';
    rankInput.className = 'rank-input';
    rankInput.value = clip.rank;
    rankInput.title = 'Platznummer frei bearbeiten (unabhängig von der Reihenfolge oben)';
    rankInput.addEventListener('change', () => updateRank(clip.id, rankInput.value));
    rankWrap.appendChild(rankPrefix);
    rankWrap.appendChild(rankInput);
    li.appendChild(rankWrap);

    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.src = clip.thumbnailPath ? `/${clip.thumbnailPath}` : '';
    thumb.alt = '';
    li.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'clip-body';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Kurzer Titel (z.B. "Backflip Fail")';
    titleInput.value = clip.title || '';
    titleInput.disabled = clip.status !== 'ready';
    titleInput.addEventListener('change', () => updateTitle(clip.id, titleInput.value));
    body.appendChild(titleInput);

    const meta = document.createElement('div');
    meta.className = 'meta' + (clip.status === 'error' ? ' status-error' : clip.status === 'downloading' ? ' status-downloading' : '');
    meta.textContent = statusLabel(clip);
    body.appendChild(meta);

    if (clip.status === 'ready') {
      body.appendChild(buildClipControls(clip));
    }

    li.appendChild(body);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Clip entfernen';
    deleteBtn.addEventListener('click', () => deleteClip(clip.id));
    li.appendChild(deleteBtn);

    attachDragHandlers(li, handle);
    listEl.appendChild(li);
  }
}

function attachDragHandlers(li, handle) {
  // Nur der Griff startet einen Drag: Waere die ganze Karte draggable, liesse
  // sich weder Text in den Eingabefeldern markieren noch die Zeitleiste der
  // Videovorschau ziehen -- beides startet sonst einen Karten-Drag.
  handle.addEventListener('mousedown', () => { li.draggable = true; });
  handle.addEventListener('mouseup', () => { li.draggable = false; });

  li.addEventListener('dragstart', (e) => {
    // Firefox startet einen Drag nur, wenn dataTransfer Daten enthaelt.
    e.dataTransfer.setData('text/plain', li.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    li.draggable = false;
    persistOrder();
  });
  li.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = listEl.querySelector('.dragging');
    if (!dragging || dragging === li) return;
    const rect = li.getBoundingClientRect();
    const after = (e.clientY - rect.top) > rect.height / 2;
    listEl.insertBefore(dragging, after ? li.nextSibling : li);
  });
}

async function persistOrder() {
  const orderedIds = Array.from(listEl.children).map((li) => li.dataset.id);
  if (orderedIds.join() === clips.map((c) => c.id).join()) return; // nichts verschoben
  setClips(await sendJson('/api/clips/order', 'PUT', { orderedIds }));
}

async function updateTitle(id, title) {
  applyClipUpdate(await sendJson(`/api/clips/${id}`, 'PUT', { title }));
}

// Leeres Feld setzt die Platznummer zurueck auf die automatische,
// positionsbasierte Nummerierung (Server interpretiert rank:null so).
async function updateRank(id, rawValue) {
  const trimmed = String(rawValue).trim();
  const rank = trimmed === '' ? null : Number(trimmed);
  if (rank !== null && !Number.isFinite(rank)) return;
  await sendJson(`/api/clips/${id}`, 'PUT', { rank });
  await loadClips();
}

// Ende leer lassen -> Server interpretiert trimEnd:null als "bis zum
// Clipende". Start/Ende werden zusaetzlich auf die bekannte Clipdauer
// geclampt, damit kein unsinniger Bereich entsteht.
async function updateTrim(id, rawStart, rawEnd, maxDuration) {
  let start = Number(rawStart);
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (maxDuration !== undefined) start = Math.min(start, maxDuration);

  const trimmedEnd = String(rawEnd).trim();
  let end = trimmedEnd === '' ? null : Number(trimmedEnd);
  if (end !== null) {
    if (!Number.isFinite(end)) return null;
    // Ende am/hinter der bekannten Dauer = "bis zum Clipende". yt-dlp liefert
    // die Dauer oft auf ganze Sekunden gerundet -- ein fest gespeichertes
    // Ende von z.B. 12 wuerde bei einem 12,4-s-Clip sonst unbemerkt das
    // letzte Stueck abschneiden.
    if (maxDuration !== undefined && end >= maxDuration) end = null;
    else if (end <= start) end = null;
  }

  const updated = await sendJson(`/api/clips/${id}`, 'PUT', { trimStart: start, trimEnd: end });
  applyClipUpdate(updated);
  return updated;
}

async function deleteClip(id) {
  await fetchJson(`/api/clips/${id}`, { method: 'DELETE' });
  await loadClips();
}

addBtn.addEventListener('click', async () => {
  addErrorEl.textContent = '';
  const urls = linksEl.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (urls.length === 0) return;

  addBtn.disabled = true;
  // Jeder Link einzeln: ein ungueltiger Link bricht die uebrigen nicht ab.
  // Fehlgeschlagene Links bleiben im Textfeld stehen, erfolgreiche nicht --
  // sonst wuerden sie beim erneuten Klick doppelt hinzugefuegt.
  const failed = [];
  const errors = [];
  for (const url of urls) {
    try {
      const clip = await sendJson('/api/clips', 'POST', { url });
      clips.push(clip);
    } catch (err) {
      failed.push(url);
      errors.push(err.message);
    }
  }
  linksEl.value = failed.join('\n');
  addErrorEl.textContent = errors.join(' · ');
  renderList();
  scheduleFollowUpPollIfNeeded();
  addBtn.disabled = false;
});

renderBtn.addEventListener('click', async () => {
  renderStatusEl.textContent = '';
  renderResultEl.hidden = true;
  renderBtn.disabled = true;
  try {
    await Promise.allSettled([...pendingSaves]);
    await fetchJson('/api/render', { method: 'POST' });
    pollRenderStatus();
  } catch (err) {
    renderStatusEl.textContent = `Fehler: ${err.message}`;
    renderBtn.disabled = false;
  }
});

function pollRenderStatus() {
  renderStatusEl.textContent = 'Video wird gerendert …';
  renderBtn.disabled = true;
  const timer = setInterval(async () => {
    let status;
    try {
      status = await fetchJson('/api/render/status');
    } catch {
      return; // Server kurz nicht erreichbar -> naechster Versuch
    }
    if (status.status === 'running') return;

    clearInterval(timer);
    renderBtn.disabled = false;

    if (status.status === 'done') {
      renderStatusEl.textContent = 'Fertig!';
      const src = `/output/${status.outputFile}`;
      renderVideoEl.src = src;
      renderDownloadEl.href = src;
      renderResultEl.hidden = false;
    } else if (status.status === 'error') {
      renderStatusEl.textContent = `Fehler beim Rendern: ${status.error}`;
    } else {
      renderStatusEl.textContent = 'Render-Vorgang wurde abgebrochen (Server neu gestartet?). Bitte erneut rendern.';
    }
  }, 1500);
}

// Wortweiser Farbeditor fuer den Gesamttitel: jedes Wort ist ein klickbarer
// Chip, der einen (unsichtbaren) nativen Farbwaehler oeffnet. Faerbung wird
// pro Wortindex in titleWordColors gespeichert; nicht eingefaerbte Woerter
// bleiben Weiss (Server-Default).
function renderTitleWordEditor() {
  const words = overallTitleEl.value.split(/\s+/).filter(Boolean);
  titleWordEditorEl.innerHTML = '';

  words.forEach((word, index) => {
    const color = titleWordColors[String(index)];

    const wrap = document.createElement('span');
    wrap.className = 'title-word-chip-wrap';

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'title-word-chip';
    chip.textContent = word;
    if (color) {
      chip.style.color = color;
      chip.style.borderColor = color;
    }

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'title-word-color-input';
    colorInput.tabIndex = -1;
    colorInput.value = color || '#ff0000';
    // 'input' feuert bei jeder Mausbewegung im Farbwaehler: nur Live-Vorschau
    // am Chip (ein Neuaufbau wuerde das Element unter dem offenen Waehler
    // entfernen, ein Request pro Bewegung waere unnoetig). Gespeichert wird
    // beim Schliessen des Waehlers ('change').
    colorInput.addEventListener('input', () => {
      chip.style.color = colorInput.value;
      chip.style.borderColor = colorInput.value;
    });
    colorInput.addEventListener('change', () => setWordColor(index, colorInput.value));

    chip.addEventListener('click', () => colorInput.click());

    wrap.appendChild(chip);
    wrap.appendChild(colorInput);

    if (color) {
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'title-word-reset';
      resetBtn.textContent = '×';
      resetBtn.title = 'Farbe zurücksetzen (weiß)';
      resetBtn.addEventListener('click', () => setWordColor(index, null));
      wrap.appendChild(resetBtn);
    }

    titleWordEditorEl.appendChild(wrap);
  });
}

async function setWordColor(index, color) {
  if (color) {
    titleWordColors[String(index)] = color;
  } else {
    delete titleWordColors[String(index)];
  }
  renderTitleWordEditor();
  await sendJson('/api/settings', 'PUT', { titleWordColors });
}

// 'input' (bei jedem Tastenanschlag) aktualisiert nur die Chip-Anzeige;
// 'change' (bei Blur) speichert den Titeltext selbst auf dem Server.
overallTitleEl.addEventListener('input', renderTitleWordEditor);
overallTitleEl.addEventListener('change', () => {
  sendJson('/api/settings', 'PUT', { title: overallTitleEl.value });
});

function updateTitleStyle() {
  sendJson('/api/settings', 'PUT', {
    titleFont: titleFontEl.value,
    titleFontSize: Number(titleSizeEl.value) || 62
  });
}
titleFontEl.addEventListener('change', updateTitleStyle);
titleSizeEl.addEventListener('change', updateTitleStyle);

async function loadFonts() {
  const fonts = await fetchJson('/api/fonts');
  titleFontEl.innerHTML = '';
  for (const font of fonts) {
    const option = document.createElement('option');
    option.value = font.key;
    option.textContent = font.label;
    titleFontEl.appendChild(option);
  }
}

async function loadSettings() {
  const settings = await fetchJson('/api/settings');
  overallTitleEl.value = settings.title || '';
  titleFontEl.value = settings.titleFont || 'arial';
  titleSizeEl.value = settings.titleFontSize || 62;
  titleWordColors = settings.titleWordColors || {};
  renderTitleWordEditor();
}

// Laeuft (z.B. nach einem Neuladen der Seite) noch ein Render-Vorgang,
// dessen Fortschritt weiter anzeigen statt den Button freizugeben.
async function resumeRenderStatus() {
  const status = await fetchJson('/api/render/status');
  if (status.status === 'running') pollRenderStatus();
}

async function init() {
  await loadFonts();
  await loadSettings();
  await loadClips();
  await resumeRenderStatus();
}

init();

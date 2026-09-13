const linksEl = document.getElementById('links');
const addBtn = document.getElementById('add-clips-btn');
const addErrorEl = document.getElementById('add-clips-error');
const listEl = document.getElementById('clip-list');
const listEmptyEl = document.getElementById('clip-list-empty');
const resetRankingBtn = document.getElementById('reset-ranking-btn');
const renderBtn = document.getElementById('render-btn');
const renderStatusEl = document.getElementById('render-status');
const renderResultEl = document.getElementById('render-result');
const renderVideoEl = document.getElementById('render-video');
const renderDownloadEl = document.getElementById('render-download');
const overallTitleEl = document.getElementById('overall-title');
const titleWordEditorEl = document.getElementById('title-word-editor');
const titleFontEl = document.getElementById('title-font');
const titleSizeEl = document.getElementById('title-size');
const totalDurationEl = document.getElementById('total-duration');

// TikToks Creator Rewards zahlt ausschliesslich fuer Videos ueber einer
// Minute. Da das die einzige der drei Plattformen ist, die pro Aufruf
// nennenswert zahlt, ist die Gesamtlaenge eine Entscheidung, die man vor
// jedem Render sehen will -- nicht erst im fertigen Video.
const TIKTOK_MIN_SECONDS = 60;

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
  // Die Liste wird hier bewusst nicht neu gebaut -- die Gesamtlaenge muss
  // sich nach einer Trim-Aenderung trotzdem sofort mitbewegen.
  updateTotalDuration();
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

// Sekunden, die dieser Clip im fertigen Video einnimmt -- also der getrimmte
// Ausschnitt, nicht die Laenge der Quelldatei. null, solange die Dauer noch
// nicht bekannt ist (Download laeuft).
function clipLength(clip) {
  if (typeof clip.duration !== 'number') return null;
  const start = Math.max(0, Number(clip.trimStart) || 0);
  const end = typeof clip.trimEnd === 'number' ? Math.min(clip.trimEnd, clip.duration) : clip.duration;
  return Math.max(0, end - start);
}

function formatSeconds(seconds) {
  return `${seconds.toFixed(1).replace('.', ',')} s`;
}

// Gesamtlaenge des fertigen Videos: alle getrimmten Clips plus der
// Startscreen, falls aktiv (gleiche Rechnung wie im Renderer).
function updateTotalDuration() {
  const known = clips.map(clipLength).filter((length) => length !== null);
  const pending = clips.length - known.length;

  if (clips.length === 0) {
    totalDurationEl.textContent = '';
    totalDurationEl.className = 'total-duration';
    return;
  }

  const introSeconds = intro && intro.enabled ? introLength() : 0;
  const total = known.reduce((sum, length) => sum + length, 0) + introSeconds;

  const parts = [`${known.length} Clip${known.length === 1 ? '' : 's'}`];
  if (introSeconds > 0) parts.push(`${formatSeconds(introSeconds)} Startscreen`);
  if (pending > 0) parts.push(`${pending} noch nicht gemessen`);

  const short = total < TIKTOK_MIN_SECONDS;
  const missing = TIKTOK_MIN_SECONDS - total;
  totalDurationEl.className = `total-duration ${short ? 'is-short' : 'is-long'}`;
  totalDurationEl.innerHTML = '';

  const line = document.createElement('span');
  line.appendChild(document.createTextNode('Gesamtlänge: '));
  const value = document.createElement('strong');
  value.textContent = formatSeconds(total);
  line.appendChild(value);
  line.appendChild(document.createTextNode(` (${parts.join(' · ')})`));
  totalDurationEl.appendChild(line);

  const note = document.createElement('span');
  note.className = 'duration-note';
  note.textContent = short
    ? `Noch ${formatSeconds(missing)} bis 60 s – darunter zahlt TikToks Creator Rewards grundsätzlich nicht.`
    : 'Über 60 s – lang genug für TikToks Creator Rewards.';
  totalDurationEl.appendChild(note);
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

// Zeile "Quelle: @handle" unter dem Clip. Fehlt das Handle (Plattform liefert
// keins), bleibt der Link zum Originalvideo -- Hauptsache, die Herkunft des
// fremden Materials ist im Tool sichtbar und nicht nur in der gespeicherten URL.
function buildSourceLine(clip) {
  if (!clip.url) return null;
  const wrap = document.createElement('div');
  wrap.className = 'clip-source';
  wrap.appendChild(document.createTextNode('Quelle: '));

  const link = document.createElement('a');
  link.href = clip.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = clip.creator && clip.creator.handle ? clip.creator.handle : 'Originalvideo';
  link.title = clip.url;
  wrap.appendChild(link);
  return wrap;
}

function renderList() {
  listEl.innerHTML = '';
  listEmptyEl.hidden = clips.length > 0;
  updateResetButton();
  updateTotalDuration();

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

    // Urheber des Quellclips: sichtbar, anklickbar, und beim Rendern als
    // Credits ins fertige Video uebernommen (siehe YouTube-Planer).
    const source = buildSourceLine(clip);
    if (source) body.appendChild(source);

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
  try {
    await fetchJson(`/api/clips/${id}`, { method: 'DELETE' });
  } catch (err) {
    alert(`Clip konnte nicht entfernt werden: ${err.message}`);
  }
  await loadClips();
}

// Nichts zum Zuruecksetzen, solange weder Clips noch ein Gesamttitel da sind.
function updateResetButton() {
  resetRankingBtn.disabled = clips.length === 0 && !overallTitleEl.value.trim();
}

// Setzt das aktuelle Ranking fuer das naechste Video zurueck: alle Clips
// (inkl. heruntergeladener Dateien) sowie Gesamttitel und Wortfarben.
// Schriftart/-groesse und bereits gerenderte Videos im Planer bleiben.
resetRankingBtn.addEventListener('click', async () => {
  const count = clips.length;
  const question = count > 0
    ? `Ranking zurücksetzen?\n\nAlle ${count} Clips werden entfernt (inkl. der heruntergeladenen Dateien), der Gesamttitel wird geleert und der Startscreen samt Sprachaufnahme wird zurückgesetzt.\n\nSchriftart, Schriftgröße und bereits gerenderte Videos im YouTube-Planer bleiben erhalten.`
    : 'Gesamttitel, Wortfarben und Startscreen zurücksetzen?';
  if (!confirm(question)) return;

  resetRankingBtn.disabled = true;
  try {
    // Ein gerade verlassenes Titelfeld speichert evtl. noch -- ohne Warten
    // kaeme der alte Titel nach dem Zuruecksetzen wieder zurueck.
    await Promise.allSettled([...pendingSaves]);
    const result = await fetchJson('/api/clips', { method: 'DELETE' });
    addErrorEl.textContent = '';
    renderStatusEl.textContent = '';
    renderResultEl.hidden = true;
    await loadSettings();
    // Der Startscreen wird serverseitig mit zurueckgesetzt -- ohne Nachladen
    // zeigte der Bereich weiter die Sprachaufnahme des alten Rankings an.
    await loadIntro();
    introEls.text.value = '';
    await loadClips();
    if (result.failedFiles > 0) {
      alert(`${result.failedFiles} Clip-Datei(en) konnten nicht gelöscht werden (evtl. von einem anderen Programm geöffnet). Die Clips sind trotzdem aus dem Ranking entfernt.`);
    }
  } catch (err) {
    alert(`Zurücksetzen fehlgeschlagen: ${err.message}`);
  } finally {
    updateResetButton();
  }
});

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
overallTitleEl.addEventListener('input', updateResetButton);
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

// ---- Startscreen (optional, vor dem ersten Clip) ----
const introEls = {
  section: document.querySelector('.intro-section'),
  enabled: document.getElementById('intro-enabled'),
  duration: document.getElementById('intro-duration'),
  profile: document.getElementById('intro-voice-profile'),
  language: document.getElementById('intro-voice-language'),
  text: document.getElementById('intro-voice-text'),
  generateBtn: document.getElementById('intro-voice-btn'),
  removeBtn: document.getElementById('intro-voice-remove'),
  status: document.getElementById('intro-status'),
  error: document.getElementById('intro-error'),
  audio: document.getElementById('intro-voice-audio')
};

let intro = { enabled: false, duration: 2, voice: null };
let voiceboxState = { available: false, profiles: [] };

// Die tatsaechliche Laenge richtet sich nach der Sprachaufnahme, mindestens
// aber nach der eingestellten Dauer (gleiche Rechnung wie im Renderer).
function introLength() {
  const voiceLength = intro.voice && intro.voice.duration ? intro.voice.duration + 0.4 : 0;
  return Math.max(2, Number(intro.duration) || 2, voiceLength);
}

function renderIntroSection() {
  introEls.enabled.checked = !!intro.enabled;
  introEls.duration.value = intro.duration ?? 2;
  introEls.section.classList.toggle('is-disabled', !intro.enabled);

  if (introEls.profile.dataset.count !== String(voiceboxState.profiles.length)) {
    introEls.profile.innerHTML = '';
    for (const profile of voiceboxState.profiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name;
      introEls.profile.appendChild(option);
    }
    introEls.profile.dataset.count = String(voiceboxState.profiles.length);
  }

  if (intro.voice) {
    if (!introEls.text.value) introEls.text.value = intro.voice.text || '';
    if (intro.voice.profileId) introEls.profile.value = intro.voice.profileId;
    if (intro.voice.language) introEls.language.value = intro.voice.language;
    introEls.audio.src = `/${intro.voice.filePath}?v=${encodeURIComponent(intro.voice.createdAt || '')}`;
  }
  introEls.audio.hidden = !intro.voice;
  introEls.removeBtn.hidden = !intro.voice;

  const canGenerate = voiceboxState.available && voiceboxState.profiles.length > 0;
  introEls.generateBtn.disabled = !canGenerate;
  introEls.status.textContent = canGenerate
    ? `Startscreen-Länge: ${introLength().toFixed(1)} s${intro.voice ? ' (richtet sich nach der Stimme)' : ''}`
    : (voiceboxState.hint || 'Voicebox läuft, hat aber noch kein Stimmprofil – lege eins unter http://localhost:5173 an.');

  // Der Startscreen zaehlt zur Gesamtlaenge des Videos.
  updateTotalDuration();
}

async function loadIntro() {
  const data = await fetchJson('/api/intro');
  intro = data.intro || intro;
  voiceboxState = data.voicebox || voiceboxState;
  renderIntroSection();
}

introEls.enabled.addEventListener('change', async () => {
  intro.enabled = introEls.enabled.checked;
  renderIntroSection();
  await sendJson('/api/settings', 'PUT', { intro: { enabled: intro.enabled } });
});

introEls.duration.addEventListener('change', async () => {
  intro.duration = Number(introEls.duration.value) || 2;
  renderIntroSection();
  await sendJson('/api/settings', 'PUT', { intro: { duration: intro.duration } });
});

introEls.generateBtn.addEventListener('click', async () => {
  const text = introEls.text.value.trim();
  if (!text) {
    introEls.error.textContent = 'Bitte einen Text eingeben.';
    return;
  }
  introEls.error.textContent = '';
  introEls.generateBtn.disabled = true;
  introEls.status.textContent = 'Stimme wird erzeugt … (beim ersten Mal lädt Voicebox das Modell, das dauert einige Minuten)';
  try {
    intro = await sendJson('/api/intro/voice', 'POST', {
      text,
      profileId: introEls.profile.value,
      language: introEls.language.value
    });
  } catch (err) {
    introEls.error.textContent = err.message;
  } finally {
    introEls.generateBtn.disabled = false;
    renderIntroSection();
  }
});

introEls.removeBtn.addEventListener('click', async () => {
  intro = await fetchJson('/api/intro/voice', { method: 'DELETE' });
  renderIntroSection();
});

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
  // Ranking und freier Schnitt teilen sich den Render-Status -- hier nur den
  // eigenen anzeigen.
  if (status.status === 'running' && status.kind !== 'cut') pollRenderStatus();
}

async function init() {
  await loadFonts();
  await loadSettings();
  await loadIntro();
  await loadClips();
  await resumeRenderStatus();
}

init();

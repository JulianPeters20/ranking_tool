// Freier Schnitt: Clips laden (Link oder Datei), trimmen, ordnen, Musik und
// eine vorgelesene Sprachspur ergaenzen, rendern. Das Ergebnis landet in
// derselben Videobibliothek wie die Ranking-Videos und damit im Planer.
const els = {
  links: document.getElementById('cut-links'),
  addBtn: document.getElementById('cut-add-btn'),
  addError: document.getElementById('cut-add-error'),
  fileInput: document.getElementById('cut-file-input'),
  list: document.getElementById('cut-list'),
  listEmpty: document.getElementById('cut-list-empty'),
  resetBtn: document.getElementById('cut-reset-btn'),
  format: document.getElementById('cut-format'),
  clipVolume: document.getElementById('cut-clip-volume'),
  clipVolumeValue: document.getElementById('cut-clip-volume-value'),
  musicInput: document.getElementById('cut-music-input'),
  musicRemove: document.getElementById('cut-music-remove'),
  musicName: document.getElementById('cut-music-name'),
  musicVolumeField: document.getElementById('cut-music-volume-field'),
  musicVolume: document.getElementById('cut-music-volume'),
  musicVolumeValue: document.getElementById('cut-music-volume-value'),
  voiceStatus: document.getElementById('cut-voice-status'),
  voiceProfile: document.getElementById('cut-voice-profile'),
  voiceLanguage: document.getElementById('cut-voice-language'),
  voiceText: document.getElementById('cut-voice-text'),
  voiceBtn: document.getElementById('cut-voice-btn'),
  voiceRemove: document.getElementById('cut-voice-remove'),
  voiceError: document.getElementById('cut-voice-error'),
  voicePreview: document.getElementById('cut-voice-preview'),
  voiceAudio: document.getElementById('cut-voice-audio'),
  voiceVolume: document.getElementById('cut-voice-volume'),
  voiceVolumeValue: document.getElementById('cut-voice-volume-value'),
  renderBtn: document.getElementById('cut-render-btn'),
  renderStatus: document.getElementById('cut-render-status'),
  renderResult: document.getElementById('cut-render-result'),
  renderVideo: document.getElementById('cut-render-video'),
  renderDownload: document.getElementById('cut-render-download')
};

let cut = { clips: [], format: 'portrait', clipVolume: 1, music: null, voice: null, formats: [], voicebox: { available: false, profiles: [] } };
let pollTimer = null;
let lastCutJson = '';

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request fehlgeschlagen (${res.status})`);
  return body;
}

function sendJson(url, method, payload) {
  return fetchJson(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function formatSeconds(value) {
  return typeof value === 'number' ? `${value.toFixed(1)}s` : '';
}

// Ein Neuaufbau der Liste zerstoert fokussierte Eingabefelder und offene
// Vorschauen -- waehrend Downloads daher nur neu zeichnen, wenn der Nutzer
// gerade nichts davon tut (gleiches Muster wie im Ranking-Teil).
function isUserBusy() {
  if (els.list.querySelector('.dragging')) return true;
  if (els.list.querySelector('.preview-wrap:not([hidden])')) return true;
  const active = document.activeElement;
  return !!active && els.list.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
}

async function load() {
  cut = await fetchJson('/api/cut');
  lastCutJson = JSON.stringify(cut.clips);
  renderAll();
  scheduleFollowUpPoll();
}

async function pollCut() {
  let data;
  try {
    data = await fetchJson('/api/cut');
  } catch {
    return;
  }
  const json = JSON.stringify(data.clips);
  if (json !== lastCutJson && !isUserBusy()) {
    cut = data;
    lastCutJson = json;
    renderAll();
  }
  if (json === lastCutJson && !data.clips.some((clip) => clip.status === 'downloading')) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function scheduleFollowUpPoll() {
  if (cut.clips.some((clip) => clip.status === 'downloading') && !pollTimer) {
    pollTimer = setInterval(pollCut, 1500);
  }
}

function buildClipCard(clip) {
  const li = document.createElement('li');
  li.className = 'clip-card';
  li.dataset.id = clip.id;

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.textContent = '⠿';
  handle.title = 'Ziehen, um die Reihenfolge zu ändern';
  li.appendChild(handle);

  const body = document.createElement('div');
  body.className = 'clip-body';

  const name = document.createElement('input');
  name.type = 'text';
  name.value = clip.name || '';
  name.addEventListener('change', () => sendJson(`/api/cut/clips/${clip.id}`, 'PUT', { name: name.value }));
  body.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'meta' + (clip.status === 'error' ? ' status-error' : clip.status === 'downloading' ? ' status-downloading' : '');
  meta.textContent = clip.status === 'downloading'
    ? 'Lädt herunter …'
    : clip.status === 'error'
      ? `Fehler: ${clip.error || 'unbekannt'}`
      : formatSeconds(clip.duration);
  body.appendChild(meta);

  if (clip.status === 'ready') {
    body.appendChild(buildTrimRow(clip));
  }

  li.appendChild(body);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = '✕';
  deleteBtn.title = 'Clip entfernen';
  deleteBtn.addEventListener('click', async () => {
    try {
      await fetchJson(`/api/cut/clips/${clip.id}`, { method: 'DELETE' });
    } catch (err) {
      alert(err.message);
    }
    await load();
  });
  li.appendChild(deleteBtn);

  attachDragHandlers(li, handle);
  return li;
}

function buildTrimRow(clip) {
  const container = document.createElement('div');
  container.className = 'clip-controls';
  const maxDuration = typeof clip.duration === 'number' ? clip.duration : undefined;

  const row = document.createElement('div');
  row.className = 'trim-row';

  const makeInput = (value) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'trim-input';
    input.min = '0';
    input.step = '0.1';
    if (maxDuration !== undefined) input.max = String(maxDuration);
    input.value = value;
    return input;
  };

  const startLabel = document.createElement('span');
  startLabel.textContent = 'Start';
  const startInput = makeInput(clip.trimStart || 0);
  const endLabel = document.createElement('span');
  endLabel.textContent = 'Ende';
  const endInput = makeInput(clip.trimEnd ?? maxDuration ?? '');

  const commit = async () => {
    let start = Number(startInput.value);
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (maxDuration !== undefined) start = Math.min(start, maxDuration);
    const rawEnd = String(endInput.value).trim();
    let end = rawEnd === '' ? null : Number(rawEnd);
    if (end !== null) {
      if (!Number.isFinite(end)) return;
      // Ende am/hinter der bekannten Dauer bedeutet "bis zum Clipende".
      if (maxDuration !== undefined && end >= maxDuration) end = null;
      else if (end <= start) end = null;
    }
    const updated = await sendJson(`/api/cut/clips/${clip.id}`, 'PUT', { trimStart: start, trimEnd: end });
    startInput.value = updated.trimStart;
    endInput.value = updated.trimEnd ?? maxDuration ?? '';
    const index = cut.clips.findIndex((entry) => entry.id === clip.id);
    if (index !== -1) cut.clips[index] = updated;
    lastCutJson = JSON.stringify(cut.clips);
  };
  startInput.addEventListener('change', commit);
  endInput.addEventListener('change', commit);

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = 'preview-toggle-btn';
  previewBtn.textContent = 'Vorschau';

  row.append(startLabel, startInput, endLabel, endInput, previewBtn);
  container.appendChild(row);

  const previewWrap = document.createElement('div');
  previewWrap.className = 'preview-wrap';
  previewWrap.hidden = true;
  const video = document.createElement('video');
  video.controls = true;
  video.className = 'preview-video';
  video.preload = 'none';

  const actions = document.createElement('div');
  actions.className = 'preview-actions';
  const setStart = document.createElement('button');
  setStart.type = 'button';
  setStart.textContent = 'Start hier setzen';
  setStart.addEventListener('click', () => { startInput.value = video.currentTime.toFixed(1); commit(); });
  const setEnd = document.createElement('button');
  setEnd.type = 'button';
  setEnd.textContent = 'Ende hier setzen';
  setEnd.addEventListener('click', () => { endInput.value = video.currentTime.toFixed(1); commit(); });
  actions.append(setStart, setEnd);
  previewWrap.append(video, actions);
  container.appendChild(previewWrap);

  previewBtn.addEventListener('click', () => {
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

// Nur der Griff startet einen Drag -- sonst liessen sich Textfelder und die
// Zeitleiste der Vorschau nicht bedienen.
function attachDragHandlers(li, handle) {
  handle.addEventListener('mousedown', () => { li.draggable = true; });
  handle.addEventListener('mouseup', () => { li.draggable = false; });
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', li.dataset.id); // Firefox braucht Daten
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
    const dragging = els.list.querySelector('.dragging');
    if (!dragging || dragging === li) return;
    const rect = li.getBoundingClientRect();
    els.list.insertBefore(dragging, (e.clientY - rect.top) > rect.height / 2 ? li.nextSibling : li);
  });
}

async function persistOrder() {
  const orderedIds = Array.from(els.list.children).map((li) => li.dataset.id);
  if (orderedIds.join() === cut.clips.map((clip) => clip.id).join()) return;
  cut = { ...cut, ...(await sendJson('/api/cut/clips/order', 'PUT', { orderedIds })) };
  lastCutJson = JSON.stringify(cut.clips);
  renderAll();
}

function renderAll() {
  els.list.innerHTML = '';
  els.listEmpty.hidden = cut.clips.length > 0;
  for (const clip of cut.clips) els.list.appendChild(buildClipCard(clip));

  if (!els.format.options.length) {
    for (const format of cut.formats || []) {
      const option = document.createElement('option');
      option.value = format.key;
      option.textContent = format.label;
      els.format.appendChild(option);
    }
  }
  els.format.value = cut.format;

  els.clipVolume.value = Math.round((cut.clipVolume ?? 1) * 100);
  els.clipVolumeValue.textContent = `${els.clipVolume.value} %`;

  els.musicName.textContent = cut.music ? `Musik: ${cut.music.name}` : 'Keine Musik ausgewählt.';
  els.musicRemove.hidden = !cut.music;
  els.musicVolumeField.hidden = !cut.music;
  if (cut.music) {
    els.musicVolume.value = Math.round((cut.music.volume ?? 0.15) * 100);
    els.musicVolumeValue.textContent = `${els.musicVolume.value} %`;
  }

  renderVoice();
}

function renderVoice() {
  const box = cut.voicebox || { available: false, profiles: [] };
  els.voiceStatus.textContent = box.available
    ? (box.profiles.length ? '' : 'Voicebox läuft, hat aber noch kein Stimmprofil – lege eins unter http://localhost:5173 an.')
    : (box.hint || 'Voicebox ist nicht erreichbar.');

  if (!els.voiceProfile.options.length || els.voiceProfile.dataset.count !== String(box.profiles.length)) {
    els.voiceProfile.innerHTML = '';
    for (const profile of box.profiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name;
      els.voiceProfile.appendChild(option);
    }
    els.voiceProfile.dataset.count = String(box.profiles.length);
  }
  els.voiceBtn.disabled = !box.available || box.profiles.length === 0;

  if (cut.voice) {
    els.voiceText.value = cut.voice.text || els.voiceText.value;
    if (cut.voice.profileId) els.voiceProfile.value = cut.voice.profileId;
    if (cut.voice.language) els.voiceLanguage.value = cut.voice.language;
    els.voiceAudio.src = `/${cut.voice.filePath}?v=${encodeURIComponent(cut.voice.createdAt || '')}`;
    els.voiceVolume.value = Math.round((cut.voice.volume ?? 1) * 100);
    els.voiceVolumeValue.textContent = `${els.voiceVolume.value} %`;
  }
  els.voicePreview.hidden = !cut.voice;
  els.voiceRemove.hidden = !cut.voice;
}

// ---- Aktionen ----

els.addBtn.addEventListener('click', async () => {
  const urls = els.links.value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (urls.length === 0) return;
  els.addBtn.disabled = true;
  els.addError.textContent = '';
  const failed = [];
  for (const url of urls) {
    try {
      await sendJson('/api/cut/clips', 'POST', { url });
    } catch (err) {
      failed.push(url);
      els.addError.textContent = err.message;
    }
  }
  els.links.value = failed.join('\n');
  els.addBtn.disabled = false;
  await load();
});

els.fileInput.addEventListener('change', async () => {
  const files = Array.from(els.fileInput.files || []);
  els.fileInput.value = '';
  for (const file of files) {
    els.addError.textContent = `Lade ${file.name} hoch …`;
    try {
      await fetchJson(`/api/cut/upload?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file
      });
      els.addError.textContent = '';
    } catch (err) {
      els.addError.textContent = `${file.name}: ${err.message}`;
    }
  }
  await load();
});

els.resetBtn.addEventListener('click', async () => {
  if (!confirm('Schnitt leeren? Alle Clips, Musik und die Sprachspur dieses Schnitts werden entfernt. Fertige Videos bleiben erhalten.')) return;
  try {
    await fetchJson('/api/cut', { method: 'DELETE' });
  } catch (err) {
    alert(err.message);
  }
  await load();
});

els.format.addEventListener('change', () => sendJson('/api/cut/settings', 'PUT', { format: els.format.value }));

els.clipVolume.addEventListener('input', () => { els.clipVolumeValue.textContent = `${els.clipVolume.value} %`; });
els.clipVolume.addEventListener('change', () => sendJson('/api/cut/settings', 'PUT', { clipVolume: Number(els.clipVolume.value) / 100 }));

els.musicInput.addEventListener('change', async () => {
  const file = els.musicInput.files && els.musicInput.files[0];
  els.musicInput.value = '';
  if (!file) return;
  try {
    cut = { ...cut, ...(await fetchJson(`/api/cut/music?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file
    })) };
    renderAll();
  } catch (err) {
    alert(`Musik konnte nicht geladen werden: ${err.message}`);
  }
});

els.musicRemove.addEventListener('click', async () => {
  cut = { ...cut, ...(await fetchJson('/api/cut/music', { method: 'DELETE' })) };
  renderAll();
});

els.musicVolume.addEventListener('input', () => { els.musicVolumeValue.textContent = `${els.musicVolume.value} %`; });
els.musicVolume.addEventListener('change', () => sendJson('/api/cut/settings', 'PUT', { musicVolume: Number(els.musicVolume.value) / 100 }));

els.voiceVolume.addEventListener('input', () => { els.voiceVolumeValue.textContent = `${els.voiceVolume.value} %`; });
els.voiceVolume.addEventListener('change', () => sendJson('/api/cut/settings', 'PUT', { voiceVolume: Number(els.voiceVolume.value) / 100 }));

els.voiceBtn.addEventListener('click', async () => {
  const text = els.voiceText.value.trim();
  if (!text) {
    els.voiceError.textContent = 'Bitte einen Text eingeben.';
    return;
  }
  els.voiceBtn.disabled = true;
  els.voiceError.textContent = '';
  els.voiceStatus.textContent = 'Stimme wird erzeugt … (beim ersten Mal lädt Voicebox das Modell, das kann einige Minuten dauern)';
  try {
    cut = { ...cut, ...(await sendJson('/api/cut/voice', 'POST', {
      text,
      profileId: els.voiceProfile.value,
      language: els.voiceLanguage.value
    })) };
    els.voiceStatus.textContent = '';
    renderVoice();
  } catch (err) {
    els.voiceError.textContent = err.message;
    els.voiceStatus.textContent = '';
  } finally {
    els.voiceBtn.disabled = false;
  }
});

els.voiceRemove.addEventListener('click', async () => {
  cut = { ...cut, ...(await fetchJson('/api/cut/voice', { method: 'DELETE' })) };
  renderVoice();
});

els.renderBtn.addEventListener('click', async () => {
  els.renderStatus.textContent = '';
  els.renderResult.hidden = true;
  els.renderBtn.disabled = true;
  try {
    await fetchJson('/api/cut/render', { method: 'POST' });
    pollRenderStatus();
  } catch (err) {
    els.renderStatus.textContent = `Fehler: ${err.message}`;
    els.renderBtn.disabled = false;
  }
});

function pollRenderStatus() {
  els.renderStatus.textContent = 'Video wird gerendert …';
  els.renderBtn.disabled = true;
  const timer = setInterval(async () => {
    let status;
    try {
      status = await fetchJson('/api/cut/render/status');
    } catch {
      return; // Server kurz nicht erreichbar -> naechster Versuch
    }
    if (status.status === 'running') return;
    clearInterval(timer);
    els.renderBtn.disabled = false;

    if (status.status === 'done') {
      els.renderStatus.textContent = 'Fertig!';
      const src = `/output/${status.outputFile}`;
      els.renderVideo.src = src;
      els.renderDownload.href = src;
      els.renderResult.hidden = false;
    } else if (status.status === 'error') {
      els.renderStatus.textContent = `Fehler beim Rendern: ${status.error}`;
    } else {
      els.renderStatus.textContent = 'Render-Vorgang wurde abgebrochen (Server neu gestartet?).';
    }
  }, 1500);
}

async function init() {
  await load();
  // Laeuft noch ein Render (z.B. nach Neuladen der Seite), Fortschritt zeigen.
  const status = await fetchJson('/api/cut/render/status');
  if (status.status === 'running' && status.kind === 'cut') pollRenderStatus();
}

init();

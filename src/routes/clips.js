const express = require('express');
const crypto = require('crypto');
const { loadClips, saveClips, loadSettings, saveSettings } = require('../services/state');
const { fetchMetadata, downloadClip, removeClipFiles, removeDownloadedFiles } = require('../services/downloader');
const { startRender, getRenderStatus } = require('../services/renderer');
const { listTitleFonts, TITLE_FONTS } = require('../services/fonts');

const router = express.Router();

// Rang wird standardmaessig aus der Position berechnet: oberster Eintrag =
// hoechste Zahl, letzter Eintrag = #1 (klassisches Countdown-Format).
// Ist rankOverride gesetzt (manuell im Frontend editiert), gewinnt dieser
// Wert -- Rang-Anzeige und Drag&Drop-Reihenfolge sind damit entkoppelt.
// Automatische Nummern ueberspringen dabei bereits manuell vergebene Plaetze:
// Bei 5 Clips mit "4" als manuellem Rang des ersten Clips bekommen die
// uebrigen 5, 3, 2, 1 -- statt dass ein zweiter Clip ebenfalls "4" zeigt.
function withRanks(clips) {
  const hasOverride = (clip) => clip.rankOverride !== null && clip.rankOverride !== undefined;
  const taken = new Set(clips.filter(hasOverride).map((c) => c.rankOverride));
  const autoCount = clips.filter((c) => !hasOverride(c)).length;

  const freeRanks = [];
  for (let rank = 1; freeRanks.length < autoCount; rank++) {
    if (!taken.has(rank)) freeRanks.push(rank);
  }
  freeRanks.reverse(); // Countdown: oberster automatischer Clip = hoechste freie Zahl

  let nextFree = 0;
  return clips.map((clip) => ({
    ...clip,
    rank: hasOverride(clip) ? clip.rankOverride : freeRanks[nextFree++]
  }));
}

router.get('/clips', (req, res) => {
  res.json(withRanks(loadClips()));
});

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

router.post('/clips', (req, res) => {
  const url = typeof (req.body || {}).url === 'string' ? req.body.url.trim() : '';
  if (!url) {
    return res.status(400).json({ error: 'Feld "url" fehlt.' });
  }
  if (!isHttpUrl(url)) {
    return res.status(400).json({ error: `Ungültiger Link (nur http/https): ${url}` });
  }

  const clips = loadClips();
  const id = crypto.randomUUID();
  const clip = {
    id,
    url,
    title: '',
    rankOverride: null,
    // Ausschnitt des Originalclips, der ins Endvideo kommt -- Sekunden ab
    // Clipanfang. trimEnd:null bedeutet "bis zum Ende des Clips".
    trimStart: 0,
    trimEnd: null,
    filePath: null,
    thumbnailPath: null,
    duration: null,
    status: 'downloading',
    error: null
  };
  clips.push(clip);
  saveClips(clips);
  res.status(202).json(withRanks(clips)[clips.length - 1]);

  // Download laeuft im Hintergrund weiter, Frontend pollt GET /api/clips.
  (async () => {
    try {
      const meta = await fetchMetadata(url);
      const files = await downloadClip(id, url);
      const current = loadClips();
      const idx = current.findIndex((c) => c.id === id);
      if (idx === -1) {
        // Wurde waehrend des Downloads geloescht -- die gerade erst
        // heruntergeladenen Dateien sonst als Waisen liegen lassen.
        removeDownloadedFiles(id);
        return;
      }
      current[idx] = {
        ...current[idx],
        title: meta.title,
        duration: meta.duration,
        filePath: files.filePath,
        thumbnailPath: files.thumbnailPath,
        status: 'ready'
      };
      saveClips(current);
    } catch (err) {
      removeDownloadedFiles(id);
      const current = loadClips();
      const idx = current.findIndex((c) => c.id === id);
      if (idx === -1) return;
      current[idx] = { ...current[idx], status: 'error', error: String(err.message || err) };
      saveClips(current);
    }
  })();
});

router.put('/clips/order', (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'Feld "orderedIds" (Array) fehlt.' });
  }
  const clips = loadClips();
  const byId = new Map(clips.map((c) => [c.id, c]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  for (const clip of clips) {
    if (!orderedIds.includes(clip.id)) reordered.push(clip);
  }
  saveClips(reordered);
  res.json(withRanks(reordered));
});

router.put('/clips/:id', (req, res) => {
  const { title, rank, trimStart, trimEnd } = req.body || {};
  const clips = loadClips();
  const idx = clips.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Clip nicht gefunden.' });

  const updated = { ...clips[idx] };
  if (typeof title === 'string') {
    updated.title = title;
  }
  if (rank === null) {
    // Override entfernen -> zurueck zur automatischen, positionsbasierten Nummer.
    updated.rankOverride = null;
  } else if (typeof rank === 'number' && Number.isFinite(rank)) {
    updated.rankOverride = rank;
  }
  if (typeof trimStart === 'number' && Number.isFinite(trimStart)) {
    updated.trimStart = Math.max(0, trimStart);
  }
  if (trimEnd === null) {
    updated.trimEnd = null;
  } else if (typeof trimEnd === 'number' && Number.isFinite(trimEnd)) {
    updated.trimEnd = trimEnd;
  }
  // Ende <= Start wuerde ffmpeg beim Rendern abbrechen lassen ("-to value
  // smaller than -ss") -> wie im Frontend als "bis zum Clipende" behandeln.
  if (updated.trimEnd !== null && updated.trimEnd !== undefined && updated.trimEnd <= updated.trimStart) {
    updated.trimEnd = null;
  }
  clips[idx] = updated;
  saveClips(clips);
  res.json(withRanks(clips)[idx]);
});

// Setzt das aktuelle Ranking fuer das naechste Video zurueck: entfernt alle
// Clips samt heruntergeladener Dateien und leert Gesamttitel + Wortfarben.
// Schriftart/-groesse bleiben, fertige Videos (videos.json) sind unberuehrt.
// Noch laufende Downloads raeumen ihre Dateien selbst auf, sobald sie merken,
// dass ihr Clip nicht mehr existiert (siehe POST /clips).
router.delete('/clips', (req, res) => {
  if (getRenderStatus().status === 'running') {
    return res.status(409).json({ error: 'Während des Renderns kann das Ranking nicht zurückgesetzt werden.' });
  }
  const clips = loadClips();
  let failedFiles = 0;
  for (const clip of clips) {
    try {
      removeClipFiles(clip);
      removeDownloadedFiles(clip.id);
    } catch {
      // Z.B. von einem anderen Programm gesperrte Datei -- der Clip wird
      // trotzdem aus dem Ranking entfernt, die Datei bleibt liegen.
      failedFiles += 1;
    }
  }
  saveClips([]);
  saveSettings({ ...loadSettings(), title: '', titleWordColors: {} });
  res.json({ ok: true, removed: clips.length, failedFiles });
});

router.delete('/clips/:id', (req, res) => {
  // Der Renderer liest die Clip-Dateien waehrend des Renderns.
  if (getRenderStatus().status === 'running') {
    return res.status(409).json({ error: 'Während des Renderns können keine Clips entfernt werden.' });
  }
  const clips = loadClips();
  const idx = clips.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Clip nicht gefunden.' });
  const [removed] = clips.splice(idx, 1);
  removeClipFiles(removed);
  saveClips(clips);
  res.json({ ok: true });
});

router.get('/fonts', (req, res) => {
  res.json(listTitleFonts());
});

router.get('/settings', (req, res) => {
  res.json(loadSettings());
});

router.put('/settings', (req, res) => {
  const { title, titleFont, titleFontSize, titleWordColors } = req.body || {};
  const settings = loadSettings();
  if (typeof title === 'string') {
    settings.title = title;
  }
  if (typeof titleFont === 'string' && TITLE_FONTS[titleFont]) {
    settings.titleFont = titleFont;
  }
  if (typeof titleFontSize === 'number' && Number.isFinite(titleFontSize) && titleFontSize > 0) {
    settings.titleFontSize = titleFontSize;
  }
  if (titleWordColors && typeof titleWordColors === 'object' && !Array.isArray(titleWordColors)) {
    const clean = {};
    for (const [index, color] of Object.entries(titleWordColors)) {
      if (/^\d+$/.test(index) && typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
        clean[index] = color;
      }
    }
    settings.titleWordColors = clean;
  }
  saveSettings(settings);
  res.json(settings);
});

router.post('/render', (req, res) => {
  const clips = withRanks(loadClips());
  if (clips.length === 0) {
    return res.status(400).json({ error: 'Keine Clips vorhanden.' });
  }
  const notReady = clips.filter((c) => c.status !== 'ready');
  if (notReady.length > 0) {
    return res.status(400).json({ error: 'Es gibt Clips, die noch nicht fertig heruntergeladen sind oder einen Fehler haben.' });
  }
  if (getRenderStatus().status === 'running') {
    return res.status(409).json({ error: 'Es laeuft bereits ein Render-Vorgang.' });
  }
  const settings = loadSettings();
  startRender(clips, settings);
  res.status(202).json({ status: 'running' });
});

router.get('/render/status', (req, res) => {
  res.json(getRenderStatus());
});

module.exports = router;

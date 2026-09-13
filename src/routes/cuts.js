const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getActiveProjectId, getProjectDir, readJson, writeJsonAtomic } = require('../services/state');
const { fetchMetadata, downloadClip, removeDownloadedFiles } = require('../services/downloader');
const { startCutRender, FORMATS } = require('../services/cutRenderer');
const { getRenderStatus, isRendering } = require('../services/renderState');
const { probeDuration } = require('../services/ffmpeg');
const voicebox = require('../services/voicebox');

const router = express.Router();

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv', '.m4v'];
const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac'];
// Als Funktion, nicht als gemeinsames Objekt: Ein geteiltes Literal wuerde
// seine clips-Liste ueber alle Aufrufe hinweg behalten (push mutiert sie),
// wodurch ein geleerter Schnitt alte Clips zurueckbraechte.
function defaultCut() {
  return { format: 'portrait', clipVolume: 1, clips: [], music: null, voice: null };
}

// Der freie Schnitt liegt pro Projekt in cut.json; die Dateien (hochgeladene
// Clips, Musik, vorgelesener Text) unter <projekt>/cut/.
function cutFile(projectId) {
  return path.join(getProjectDir(projectId), 'cut.json');
}

function cutFolder(projectId) {
  return path.join(getProjectDir(projectId), 'cut');
}

function loadCut(projectId) {
  return { ...defaultCut(), ...readJson(cutFile(projectId), {}) };
}

function saveCut(cut, projectId) {
  writeJsonAtomic(cutFile(projectId), cut);
  return cut;
}

// Dateinamen vom Nutzer nie direkt uebernehmen (Pfad-Tricks wie ../..):
// nur die Endung wird gebraucht, der Name selbst wird zur zufaelligen ID.
function safeExtension(name, allowed) {
  const ext = path.extname(String(name || '')).toLowerCase();
  return allowed.includes(ext) ? ext : null;
}

// Nimmt den rohen Request-Body entgegen und schreibt ihn in eine Datei --
// so braucht es keine zusaetzliche Upload-Bibliothek. express.json() greift
// nicht, weil der Browser application/octet-stream schickt.
function receiveUpload(req, targetPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const stream = fs.createWriteStream(targetPath);
    req.pipe(stream);
    req.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', resolve);
  });
}

router.get('/cut', async (req, res) => {
  const projectId = getActiveProjectId();
  res.json({
    ...loadCut(projectId),
    formats: Object.entries(FORMATS).map(([key, value]) => ({ key, label: value.label })),
    voicebox: await voicebox.getStatus()
  });
});

router.put('/cut/settings', (req, res) => {
  const projectId = getActiveProjectId();
  const cut = loadCut(projectId);
  const { format, clipVolume, musicVolume, voiceVolume } = req.body || {};

  if (typeof format === 'string' && FORMATS[format]) cut.format = format;
  if (typeof clipVolume === 'number' && clipVolume >= 0 && clipVolume <= 2) cut.clipVolume = clipVolume;
  if (typeof musicVolume === 'number' && cut.music) cut.music.volume = Math.max(0, Math.min(2, musicVolume));
  if (typeof voiceVolume === 'number' && cut.voice) cut.voice.volume = Math.max(0, Math.min(2, voiceVolume));

  res.json(saveCut(cut, projectId));
});

// Clip per Link (TikTok, YouTube, ...) -- laeuft wie im Ranking-Teil im
// Hintergrund weiter, das Frontend pollt GET /api/cut.
router.post('/cut/clips', (req, res) => {
  const url = typeof (req.body || {}).url === 'string' ? req.body.url.trim() : '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Bitte einen gültigen Link angeben.' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Nur http/https-Links werden unterstützt.' });
  }

  const projectId = getActiveProjectId();
  const cut = loadCut(projectId);
  const id = crypto.randomUUID();
  cut.clips.push({
    id, source: 'link', url, name: url, filePath: null, duration: null,
    trimStart: 0, trimEnd: null, status: 'downloading', error: null
  });
  saveCut(cut, projectId);
  res.status(202).json({ ok: true, id });

  (async () => {
    try {
      const meta = await fetchMetadata(url);
      const files = await downloadClip(id, url, projectId, 'cut');
      const current = loadCut(projectId);
      const clip = current.clips.find((entry) => entry.id === id);
      if (!clip) {
        removeDownloadedFiles(id, projectId, 'cut');
        return;
      }
      Object.assign(clip, {
        name: meta.title || clip.name,
        duration: meta.duration,
        filePath: files.filePath,
        status: 'ready'
      });
      saveCut(current, projectId);
    } catch (err) {
      removeDownloadedFiles(id, projectId, 'cut');
      const current = loadCut(projectId);
      const clip = current.clips.find((entry) => entry.id === id);
      if (!clip) return;
      Object.assign(clip, { status: 'error', error: String(err.message || err) });
      saveCut(current, projectId);
    }
  })();
});

// Clip vom eigenen Rechner (roher Body, Dateiname als ?name=...)
router.post('/cut/upload', async (req, res) => {
  const ext = safeExtension(req.query.name, VIDEO_EXTENSIONS);
  if (!ext) {
    return res.status(400).json({ error: `Dateityp nicht unterstützt. Erlaubt: ${VIDEO_EXTENSIONS.join(', ')}` });
  }
  const projectId = getActiveProjectId();
  const id = crypto.randomUUID();
  const targetPath = path.join(cutFolder(projectId), `${id}${ext}`);

  try {
    await receiveUpload(req, targetPath);
    const cut = loadCut(projectId);
    cut.clips.push({
      id,
      source: 'upload',
      name: String(req.query.name).slice(0, 120),
      filePath: `cut/${id}${ext}`,
      duration: await probeDuration(targetPath),
      trimStart: 0,
      trimEnd: null,
      status: 'ready',
      error: null
    });
    saveCut(cut, projectId);
    res.status(201).json(cut.clips[cut.clips.length - 1]);
  } catch (err) {
    fs.rmSync(targetPath, { force: true });
    res.status(500).json({ error: `Upload fehlgeschlagen: ${String(err.message || err)}` });
  }
});

router.put('/cut/clips/order', (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'Feld "orderedIds" (Array) fehlt.' });
  const projectId = getActiveProjectId();
  const cut = loadCut(projectId);
  const byId = new Map(cut.clips.map((clip) => [clip.id, clip]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  for (const clip of cut.clips) if (!orderedIds.includes(clip.id)) reordered.push(clip);
  cut.clips = reordered;
  res.json(saveCut(cut, projectId));
});

router.put('/cut/clips/:id', (req, res) => {
  const projectId = getActiveProjectId();
  const cut = loadCut(projectId);
  const clip = cut.clips.find((entry) => entry.id === req.params.id);
  if (!clip) return res.status(404).json({ error: 'Clip nicht gefunden.' });

  const { trimStart, trimEnd, name } = req.body || {};
  if (typeof name === 'string') clip.name = name.slice(0, 120);
  if (typeof trimStart === 'number' && Number.isFinite(trimStart)) clip.trimStart = Math.max(0, trimStart);
  if (trimEnd === null) clip.trimEnd = null;
  else if (typeof trimEnd === 'number' && Number.isFinite(trimEnd)) clip.trimEnd = trimEnd;
  // Ende <= Start wuerde ffmpeg abbrechen lassen -> "bis zum Clipende".
  if (clip.trimEnd !== null && clip.trimEnd !== undefined && clip.trimEnd <= clip.trimStart) clip.trimEnd = null;

  saveCut(cut, projectId);
  res.json(clip);
});

router.delete('/cut/clips/:id', (req, res) => {
  if (isRendering()) return res.status(409).json({ error: 'Während des Renderns können keine Clips entfernt werden.' });
  const projectId = getActiveProjectId();
  const cut = loadCut(projectId);
  const idx = cut.clips.findIndex((entry) => entry.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Clip nicht gefunden.' });

  const [removed] = cut.clips.splice(idx, 1);
  if (removed.filePath) fs.rmSync(path.join(getProjectDir(projectId), removed.filePath), { force: true });
  removeDownloadedFiles(removed.id, projectId, 'cut');
  saveCut(cut, projectId);
  res.json({ ok: true });
});

router.post('/cut/music', async (req, res) => {
  const ext = safeExtension(req.query.name, AUDIO_EXTENSIONS);
  if (!ext) {
    return res.status(400).json({ error: `Dateityp nicht unterstützt. Erlaubt: ${AUDIO_EXTENSIONS.join(', ')}` });
  }
  const projectId = getActiveProjectId();
  const targetPath = path.join(cutFolder(projectId), `music${ext}`);
  try {
    await receiveUpload(req, targetPath);
    const cut = loadCut(projectId);
    // Vorherige Musik in einem anderen Format entfernen.
    for (const other of AUDIO_EXTENSIONS.filter((entry) => entry !== ext)) {
      fs.rmSync(path.join(cutFolder(projectId), `music${other}`), { force: true });
    }
    cut.music = { name: String(req.query.name).slice(0, 120), filePath: `cut/music${ext}`, volume: cut.music ? cut.music.volume : 0.15 };
    res.status(201).json(saveCut(cut, projectId));
  } catch (err) {
    // Halb geschriebene Datei entfernen (wie beim Clip-Upload) -- sie wuerde
    // sonst als vermeintliche Musik liegen bleiben und beim naechsten Render
    // mitgemischt.
    fs.rmSync(targetPath, { force: true });
    res.status(500).json({ error: `Upload fehlgeschlagen: ${String(err.message || err)}` });
  }
});

router.delete('/cut/music', (req, res) => {
  const projectId = getActiveProjectId();
  const cut = loadCut(projectId);
  if (cut.music && cut.music.filePath) {
    fs.rmSync(path.join(getProjectDir(projectId), cut.music.filePath), { force: true });
  }
  cut.music = null;
  res.json(saveCut(cut, projectId));
});

// Text von der eigenen (in Voicebox geklonten) Stimme vorlesen lassen und als
// Sprachspur ins Projekt legen. Die erste Erzeugung kann lange dauern, weil
// Voicebox dabei das Modell herunterlaedt.
router.post('/cut/voice', async (req, res) => {
  const { text, profileId, language } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Bitte einen Text eingeben, der vorgelesen werden soll.' });
  }
  if (typeof profileId !== 'string' || !profileId) {
    return res.status(400).json({ error: 'Bitte ein Stimmprofil auswählen (in Voicebox anlegen).' });
  }

  const projectId = getActiveProjectId();
  const targetPath = path.join(cutFolder(projectId), 'voice.wav');
  try {
    await voicebox.generateSpeech({ text: text.trim(), profileId, language: language || 'en' }, targetPath);
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }

  const cut = loadCut(projectId);
  cut.voice = {
    text: text.trim(),
    profileId,
    language: language || 'en',
    filePath: 'cut/voice.wav',
    volume: cut.voice ? cut.voice.volume : 1,
    duration: await probeDuration(targetPath),
    createdAt: new Date().toISOString()
  };
  res.status(201).json(saveCut(cut, projectId));
});

router.delete('/cut/voice', (req, res) => {
  const projectId = getActiveProjectId();
  const cut = loadCut(projectId);
  if (cut.voice && cut.voice.filePath) {
    fs.rmSync(path.join(getProjectDir(projectId), cut.voice.filePath), { force: true });
  }
  cut.voice = null;
  res.json(saveCut(cut, projectId));
});

router.post('/cut/render', (req, res) => {
  const projectId = getActiveProjectId();
  const cut = loadCut(projectId);
  if (cut.clips.length === 0) return res.status(400).json({ error: 'Noch keine Clips im Schnitt.' });
  const notReady = cut.clips.filter((clip) => clip.status !== 'ready' || !clip.filePath);
  if (notReady.length > 0) {
    return res.status(400).json({ error: 'Es gibt Clips, die noch laden oder fehlerhaft sind.' });
  }
  if (isRendering()) return res.status(409).json({ error: 'Es läuft bereits ein Render-Vorgang.' });

  startCutRender(cut, projectId);
  res.status(202).json({ status: 'running' });
});

// Ranking und freier Schnitt teilen sich ffmpeg -- daher ein gemeinsamer Status.
router.get('/cut/render/status', (req, res) => {
  res.json(getRenderStatus());
});

router.delete('/cut', (req, res) => {
  if (isRendering()) return res.status(409).json({ error: 'Während des Renderns kann der Schnitt nicht geleert werden.' });
  const projectId = getActiveProjectId();
  fs.rmSync(cutFolder(projectId), { recursive: true, force: true });
  res.json(saveCut(defaultCut(), projectId));
});

module.exports = router;

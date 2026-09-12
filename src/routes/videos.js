const express = require('express');
const { loadVideos, saveVideos, removeVideo } = require('../services/videoLibrary');
const { attemptUpload } = require('../services/uploadScheduler');
const { getActiveProjectId } = require('../services/state');

const router = express.Router();

// YouTube lehnt ungueltige Metadaten erst nach dem kompletten Datei-Upload ab
// -- und der Retry wuerde es danach alle 5 Minuten erneut versuchen. Daher
// schon beim Einplanen pruefen (Grenzen laut YouTube Data API).
function validateForYoutube(video) {
  const title = (video.youtubeTitle || '').trim();
  const description = video.youtubeDescription || '';
  if (!title) return 'Bitte zuerst einen Titel für das Video eintragen.';
  const titleLength = [...title].length;
  if (titleLength > 100) {
    return `Der YouTube-Titel darf höchstens 100 Zeichen lang sein (aktuell ${titleLength}).`;
  }
  if (/[<>]/.test(title) || /[<>]/.test(description)) {
    return 'Titel und Beschreibung dürfen keine spitzen Klammern (< >) enthalten – YouTube lehnt sie ab.';
  }
  if (Buffer.byteLength(`${description}\n\n#Shorts`, 'utf8') > 5000) {
    return 'Die Beschreibung ist zu lang (max. 5000 Bytes inkl. angehängtem #Shorts).';
  }
  return null;
}

router.get('/videos', (req, res) => {
  res.json(loadVideos());
});

router.put('/videos/:id', (req, res) => {
  const { youtubeTitle, youtubeDescription, tags, madeForKids } = req.body || {};
  const videos = loadVideos();
  const idx = videos.findIndex((v) => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Video nicht gefunden.' });

  const updated = { ...videos[idx] };
  if (typeof youtubeTitle === 'string') updated.youtubeTitle = youtubeTitle;
  if (typeof youtubeDescription === 'string') updated.youtubeDescription = youtubeDescription;
  if (Array.isArray(tags)) updated.tags = tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof madeForKids === 'boolean') updated.madeForKids = madeForKids;

  videos[idx] = updated;
  saveVideos(videos);
  res.json(updated);
});

router.delete('/videos/:id', (req, res) => {
  const video = loadVideos().find((v) => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: 'Video nicht gefunden.' });
  if (video.uploadStatus === 'uploading') {
    return res.status(409).json({ error: 'Video wird gerade hochgeladen -- bitte warten, bis der Upload fertig ist.' });
  }
  removeVideo(req.params.id);
  res.json({ ok: true });
});

router.put('/videos/:id/schedule', (req, res) => {
  const { scheduledAt } = req.body || {};
  if (typeof scheduledAt !== 'string' || !scheduledAt) {
    return res.status(400).json({ error: 'Feld "scheduledAt" (ISO-Datum) fehlt.' });
  }
  const scheduledDate = new Date(scheduledAt);
  if (Number.isNaN(scheduledDate.getTime())) {
    return res.status(400).json({ error: 'Ungültiges Datum/Uhrzeit.' });
  }
  if (scheduledDate.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'Der Zeitpunkt liegt in der Vergangenheit – bitte einen zukünftigen Slot wählen.' });
  }
  const videos = loadVideos();
  const idx = videos.findIndex((v) => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Video nicht gefunden.' });
  if (videos[idx].uploadStatus === 'scheduled_on_youtube') {
    return res.status(409).json({ error: 'Video ist bereits auf YouTube hochgeladen.' });
  }
  if (videos[idx].uploadStatus === 'uploading') {
    // Der laufende Upload nutzt noch den alten Zeitpunkt.
    return res.status(409).json({ error: 'Video wird gerade hochgeladen -- Zeitpunkt danach nur noch in YouTube Studio änderbar.' });
  }
  const validationError = validateForYoutube(videos[idx]);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  videos[idx] = { ...videos[idx], scheduledAt: scheduledDate.toISOString(), error: null };
  saveVideos(videos);
  res.json(videos[idx]);

  // Laeuft im Hintergrund weiter, Frontend pollt GET /api/videos. Das Projekt
  // wird mitgegeben, damit ein Projektwechsel den laufenden Upload nicht trifft.
  attemptUpload(req.params.id, getActiveProjectId());
});

router.put('/videos/:id/unschedule', (req, res) => {
  const videos = loadVideos();
  const idx = videos.findIndex((v) => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Video nicht gefunden.' });
  if (videos[idx].uploadStatus === 'scheduled_on_youtube' || videos[idx].uploadStatus === 'uploading') {
    return res.status(409).json({ error: 'Video ist bereits (oder wird gerade) auf YouTube hochgeladen -- Änderungen nur noch in YouTube Studio möglich.' });
  }
  videos[idx] = { ...videos[idx], scheduledAt: null, uploadStatus: 'draft', error: null };
  saveVideos(videos);
  res.json(videos[idx]);
});

module.exports = router;

const express = require('express');
const { loadVideos, saveVideos, removeVideo } = require('../services/videoLibrary');
const { attemptUpload } = require('../services/uploadScheduler');

const router = express.Router();

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
  const removed = removeVideo(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Video nicht gefunden.' });
  res.json({ ok: true });
});

router.put('/videos/:id/schedule', (req, res) => {
  const { scheduledAt } = req.body || {};
  if (typeof scheduledAt !== 'string' || !scheduledAt) {
    return res.status(400).json({ error: 'Feld "scheduledAt" (ISO-Datum) fehlt.' });
  }
  const videos = loadVideos();
  const idx = videos.findIndex((v) => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Video nicht gefunden.' });
  if (!videos[idx].youtubeTitle || !videos[idx].youtubeTitle.trim()) {
    return res.status(400).json({ error: 'Bitte zuerst einen Titel für das Video eintragen.' });
  }
  if (videos[idx].uploadStatus === 'scheduled_on_youtube') {
    return res.status(409).json({ error: 'Video ist bereits auf YouTube hochgeladen.' });
  }

  videos[idx] = { ...videos[idx], scheduledAt, error: null };
  saveVideos(videos);
  res.json(videos[idx]);

  // Laeuft im Hintergrund weiter, Frontend pollt GET /api/videos.
  attemptUpload(req.params.id);
});

router.put('/videos/:id/unschedule', (req, res) => {
  const videos = loadVideos();
  const idx = videos.findIndex((v) => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Video nicht gefunden.' });
  if (videos[idx].uploadStatus === 'scheduled_on_youtube') {
    return res.status(409).json({ error: 'Video ist bereits auf YouTube hochgeladen -- Änderungen nur noch in YouTube Studio möglich.' });
  }
  videos[idx] = { ...videos[idx], scheduledAt: null, uploadStatus: 'draft', error: null };
  saveVideos(videos);
  res.json(videos[idx]);
});

module.exports = router;

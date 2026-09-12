const express = require('express');
const youtubeService = require('../services/youtube');
const { getActiveProjectId } = require('../services/state');

// Dieser Router wird ungeprefixt auf App-Root gemountet, da /auth/youtube/callback
// exakt der bei Google hinterlegten Redirect-URI entsprechen muss.
// Der Kanal haengt am jeweils aktiven Projekt (ein Projekt = ein Kanal).
const router = express.Router();

router.get('/api/youtube/status', async (req, res) => {
  const projectId = getActiveProjectId();
  const configured = youtubeService.isConfigured();
  const connected = youtubeService.isConnected(projectId);
  let channelTitle = null;
  let error = null;

  if (connected) {
    try {
      const channel = await youtubeService.getChannelInfo(projectId);
      channelTitle = channel ? channel.title : null;
    } catch (err) {
      error = String(err.message || err);
    }
  }

  res.json({ configured, connected, channelTitle, error, projectId });
});

router.put('/api/youtube/credentials', (req, res) => {
  const { clientId, clientSecret } = req.body || {};
  if (typeof clientId !== 'string' || !clientId.trim() || typeof clientSecret !== 'string' || !clientSecret.trim()) {
    return res.status(400).json({ error: 'Client-ID und Client-Secret sind erforderlich.' });
  }
  youtubeService.saveCredentials(clientId.trim(), clientSecret.trim());
  res.json({ ok: true });
});

router.post('/api/youtube/disconnect', (req, res) => {
  youtubeService.disconnect(getActiveProjectId());
  res.json({ ok: true });
});

router.get('/auth/youtube/start', (req, res) => {
  try {
    const url = youtubeService.getAuthUrl(getActiveProjectId());
    res.redirect(url);
  } catch (err) {
    res.status(400).send(`Fehler: ${String(err.message || err)}. Bitte zuerst Client-ID/Secret auf der Planer-Seite eintragen.`);
  }
});

router.get('/auth/youtube/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.redirect(`/schedule.html?youtube_auth=error&message=${encodeURIComponent(String(error))}`);
  }
  try {
    await youtubeService.handleOAuthCallback(code ? String(code) : '', String(state || ''));
    res.redirect('/schedule.html?youtube_auth=success');
  } catch (err) {
    res.redirect(`/schedule.html?youtube_auth=error&message=${encodeURIComponent(String(err.message || err))}`);
  }
});

module.exports = router;

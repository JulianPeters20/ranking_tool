const express = require('express');
const path = require('path');
const { DATA_DIR } = require('./src/services/state');
const clipsRouter = require('./src/routes/clips');
const videosRouter = require('./src/routes/videos');
const youtubeRouter = require('./src/routes/youtube');
const { resetStaleUploads, retryPendingUploads } = require('./src/services/uploadScheduler');

const app = express();
const PORT = process.env.PORT || 3000;
// Standardmaessig nur lokal erreichbar: die API hat keine Anmeldung, und
// jeder im selben Netzwerk koennte sonst Clips/Videos loeschen oder
// YouTube-Uploads anstossen. Fuer LAN-Zugriff bewusst HOST=0.0.0.0 setzen.
const HOST = process.env.HOST || '127.0.0.1';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Thumbnails der heruntergeladenen Clips
app.use('/clips', express.static(path.join(DATA_DIR, 'clips')));
// Fertig gerenderte Videos (Vorschau/Download) + deren Thumbnails
app.use('/output', express.static(path.join(DATA_DIR, 'output')));

app.use('/api', clipsRouter);
app.use('/api', videosRouter);
app.use(youtubeRouter); // definiert eigene Pfade inkl. /auth/youtube/callback

const RETRY_INTERVAL_MS = 5 * 60 * 1000;

app.listen(PORT, HOST, () => {
  console.log(`Ranking-Clips-Tool laeuft auf http://localhost:${PORT}`);

  // Von einem vorherigen Lauf haengengebliebene Uploads (App war zu,
  // abgestuerzt, kein Internet) beim Start erkennen und erneut versuchen,
  // danach alle 5 Minuten weiter pruefen -- ohne dass der Rechner zum
  // eigentlichen Veroeffentlichungszeitpunkt selbst laufen muss (das
  // uebernimmt YouTubes eigenes status.publishAt).
  resetStaleUploads();
  retryPendingUploads();
  setInterval(retryPendingUploads, RETRY_INTERVAL_MS);
});

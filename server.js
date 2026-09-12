const express = require('express');
const path = require('path');
const { getProjectDir } = require('./src/services/state');
const projectsRouter = require('./src/routes/projects');
const clipsRouter = require('./src/routes/clips');
const cutsRouter = require('./src/routes/cuts');
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

// Clips und fertige Videos liegen im Ordner des jeweils aktiven Projekts --
// der Pfad wird deshalb pro Anfrage aufgeloest statt einmalig beim Start.
function serveFromActiveProject(subdir) {
  return (req, res, next) => express.static(path.join(getProjectDir(), subdir))(req, res, next);
}

// Thumbnails der heruntergeladenen Clips
app.use('/clips', serveFromActiveProject('clips'));
// Fertig gerenderte Videos (Vorschau/Download) + deren Thumbnails
app.use('/output', serveFromActiveProject('output'));

// Dateien des freien Schnitts (hochgeladene Clips, Musik, Sprachspur)
app.use('/cut', serveFromActiveProject('cut'));

app.use('/api', projectsRouter);
app.use('/api', cutsRouter);
app.use('/api', clipsRouter);
app.use('/api', videosRouter);
app.use(youtubeRouter); // definiert eigene Pfade inkl. /auth/youtube/callback

const RETRY_INTERVAL_MS = 5 * 60 * 1000;

app.listen(PORT, HOST, () => {
  console.log(`Ranking-Clips-Tool laeuft auf http://localhost:${PORT}`);

  // Von einem vorherigen Lauf haengengebliebene Uploads (App war zu,
  // abgestuerzt, kein Internet) beim Start erkennen und erneut versuchen,
  // danach alle 5 Minuten weiter pruefen -- ueber alle Projekte hinweg und
  // ohne dass der Rechner zum eigentlichen Veroeffentlichungszeitpunkt selbst
  // laufen muss (das uebernimmt YouTubes eigenes status.publishAt).
  resetStaleUploads();
  retryPendingUploads();
  setInterval(retryPendingUploads, RETRY_INTERVAL_MS);
});

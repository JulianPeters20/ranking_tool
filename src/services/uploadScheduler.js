// Stoesst den eigentlichen YouTube-Upload an und faengt Unterbrechungen ab
// (App war zu, kein Internet, Absturz waehrend eines Uploads) durch erneute
// Versuche beim Serverstart und danach periodisch.
// Laeuft ueber ALLE Projekte -- ein geplanter Upload soll nicht davon
// abhaengen, welches Projekt im Frontend gerade geoeffnet ist.
const { loadVideos, saveVideos, listVideosOfAllProjects } = require('./videoLibrary');
const youtubeService = require('./youtube');

const PAST_SCHEDULE_ERROR = 'Geplanter Zeitpunkt liegt inzwischen in der Vergangenheit (App war bis dahin aus?) – bitte im Kalender neu einplanen.';

// Jeder Versuch laedt die komplette Videodatei hoch und kostet ~1600
// Quota-Einheiten -- das Tageskontingent reicht fuer rund 6 Uploads und gilt
// fuer ALLE Projekte zusammen (ein Google-Cloud-Projekt). Ein dauerhafter
// Fehler (abgelehnte Metadaten, gesperrter Kanal, kaputte Datei) wuerde sich
// sonst alle 5 Minuten wiederholen und das Kontingent fuer die anderen Kanaele
// mit aufbrauchen. Nach MAX_UPLOAD_ATTEMPTS bleibt der Eintrag als Fehler
// stehen, bis er im Planer neu eingeplant wird (das setzt den Zaehler zurueck).
const MAX_UPLOAD_ATTEMPTS = 3;

function updateVideo(id, patch, projectId) {
  const videos = loadVideos(projectId);
  const idx = videos.findIndex((v) => v.id === id);
  if (idx === -1) return null;
  videos[idx] = { ...videos[idx], ...patch };
  saveVideos(videos, projectId);
  return videos[idx];
}

async function attemptUpload(id, projectId) {
  const videos = loadVideos(projectId);
  const entry = videos.find((v) => v.id === id);
  if (!entry || !entry.scheduledAt) return;
  if (entry.uploadStatus === 'scheduled_on_youtube' || entry.uploadStatus === 'uploading') return;

  // YouTube lehnt ein publishAt in der Vergangenheit ab -- ein Versuch wuerde
  // nur die komplette Datei hochladen, scheitern und sich alle 5 Minuten
  // wiederholen. Stattdessen einmalig als Fehler markieren.
  if (new Date(entry.scheduledAt).getTime() <= Date.now()) {
    if (entry.error !== PAST_SCHEDULE_ERROR) {
      updateVideo(id, { uploadStatus: 'error', error: PAST_SCHEDULE_ERROR }, projectId);
    }
    return;
  }

  const attempts = Number(entry.uploadAttempts) || 0;
  if (attempts >= MAX_UPLOAD_ATTEMPTS) return;

  updateVideo(id, { uploadStatus: 'uploading', error: null, uploadAttempts: attempts + 1 }, projectId);
  try {
    const youtubeVideoId = await youtubeService.uploadVideo(entry, projectId);
    updateVideo(id, { uploadStatus: 'scheduled_on_youtube', youtubeVideoId, error: null }, projectId);
  } catch (err) {
    const used = attempts + 1;
    const giveUp = used >= MAX_UPLOAD_ATTEMPTS;
    updateVideo(id, {
      uploadStatus: 'error',
      error: giveUp
        ? `${String(err.message || err)} (nach ${used} Versuchen aufgegeben – im Kalender neu einplanen, um es erneut zu versuchen)`
        : String(err.message || err)
    }, projectId);
  }
}

// Ein Eintrag, der beim letzten Serverstopp mitten in 'uploading' haengen
// geblieben ist, ist mit Sicherheit kein echter laufender Upload mehr --
// zuruecksetzen, damit retryPendingUploads() ihn erneut aufgreift.
function resetStaleUploads() {
  const byProject = new Map();
  for (const { projectId, video } of listVideosOfAllProjects()) {
    if (video.uploadStatus !== 'uploading') continue;
    if (!byProject.has(projectId)) byProject.set(projectId, loadVideos(projectId));
    const videos = byProject.get(projectId);
    const entry = videos.find((v) => v.id === video.id);
    if (entry) {
      entry.uploadStatus = 'error';
      entry.error = 'Unterbrochen (Server wurde neu gestartet) -- wird erneut versucht.';
    }
  }
  for (const [projectId, videos] of byProject) saveVideos(videos, projectId);
}

async function retryPendingUploads() {
  const pending = listVideosOfAllProjects().filter(({ video }) =>
    video.scheduledAt && video.uploadStatus !== 'scheduled_on_youtube' && video.uploadStatus !== 'uploading'
  );
  for (const { projectId, video } of pending) {
    await attemptUpload(video.id, projectId);
  }
}

module.exports = { attemptUpload, retryPendingUploads, resetStaleUploads };

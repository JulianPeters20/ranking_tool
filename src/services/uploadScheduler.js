// Stoesst den eigentlichen YouTube-Upload an und faengt Unterbrechungen ab
// (App war zu, kein Internet, Absturz waehrend eines Uploads) durch erneute
// Versuche beim Serverstart und danach periodisch.
const { loadVideos, saveVideos } = require('./videoLibrary');
const youtubeService = require('./youtube');

function updateVideo(id, patch) {
  const videos = loadVideos();
  const idx = videos.findIndex((v) => v.id === id);
  if (idx === -1) return null;
  videos[idx] = { ...videos[idx], ...patch };
  saveVideos(videos);
  return videos[idx];
}

async function attemptUpload(id) {
  const videos = loadVideos();
  const entry = videos.find((v) => v.id === id);
  if (!entry || !entry.scheduledAt) return;
  if (entry.uploadStatus === 'scheduled_on_youtube' || entry.uploadStatus === 'uploading') return;

  updateVideo(id, { uploadStatus: 'uploading', error: null });
  try {
    const youtubeVideoId = await youtubeService.uploadVideo(entry);
    updateVideo(id, { uploadStatus: 'scheduled_on_youtube', youtubeVideoId, error: null });
  } catch (err) {
    updateVideo(id, { uploadStatus: 'error', error: String(err.message || err) });
  }
}

// Ein Eintrag, der beim letzten Serverstopp mitten in 'uploading' haengen
// geblieben ist, ist mit Sicherheit kein echter laufender Upload mehr --
// zuruecksetzen, damit retryPendingUploads() ihn erneut aufgreift.
function resetStaleUploads() {
  const videos = loadVideos();
  let changed = false;
  for (const v of videos) {
    if (v.uploadStatus === 'uploading') {
      v.uploadStatus = 'error';
      v.error = 'Unterbrochen (Server wurde neu gestartet) -- wird erneut versucht.';
      changed = true;
    }
  }
  if (changed) saveVideos(videos);
}

async function retryPendingUploads() {
  const videos = loadVideos();
  const pending = videos.filter(
    (v) => v.scheduledAt && v.uploadStatus !== 'scheduled_on_youtube' && v.uploadStatus !== 'uploading'
  );
  for (const entry of pending) {
    await attemptUpload(entry.id);
  }
}

module.exports = { attemptUpload, retryPendingUploads, resetStaleUploads };

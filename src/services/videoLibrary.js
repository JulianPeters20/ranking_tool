// Bibliothek fertig gerenderter Ranking-Videos, bereit zur Planung/zum
// YouTube-Upload -- pro Projekt (jeder Kanal hat seine eigene Bibliothek),
// getrennt von project.json (das beschreibt nur den gerade zusammengestellten
// Clip-Satz, nicht die Historie fertiger Videos).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { getProjectDir, writeJsonAtomic, readJson, listProjects } = require('./state');
const { probeSize } = require('./ffmpeg');

function videosFile(projectId) {
  return path.join(getProjectDir(projectId), 'videos.json');
}

function outputDir(projectId) {
  return path.join(getProjectDir(projectId), 'output');
}

function loadVideos(projectId) {
  return readJson(videosFile(projectId), []);
}

function saveVideos(videos, projectId) {
  writeJsonAtomic(videosFile(projectId), videos);
}

function extractThumbnail(videoAbsPath, outAbsPath) {
  return new Promise((resolve) => {
    const proc = spawn(
      'ffmpeg',
      ['-y', '-ss', '1', '-i', videoAbsPath, '-frames:v', '1', '-update', '1', outAbsPath],
      { windowsHide: true }
    );
    // Thumbnail-Fehler sind nicht kritisch fuers Feature -- einfach ohne
    // Thumbnail weitermachen statt die Registrierung fehlschlagen zu lassen.
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });
}

// Quellenliste eines fertigen Videos: welcher fremde Clip von wem stammt.
// Wird beim Rendern eingefroren, weil die Clipliste danach fuer das naechste
// Video zurueckgesetzt wird -- ohne diese Kopie waere im Planer nicht mehr
// feststellbar, wen das Video zeigt. Doppelte Urheber (mehrere Clips desselben
// Kanals) erscheinen nur einmal.
function collectSources(clips) {
  const seen = new Set();
  const sources = [];
  for (const clip of clips || []) {
    if (!clip || !clip.url) continue; // hochgeladene Dateien haben keine Quelle
    const handle = clip.creator && clip.creator.handle ? clip.creator.handle : null;
    const key = handle || clip.url;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      handle,
      profileUrl: clip.creator && clip.creator.url ? clip.creator.url : null,
      url: clip.url
    });
  }
  return sources;
}

// Wird von renderer.js/cutRenderer.js nach jedem erfolgreichen Render aufgerufen.
async function registerRenderedVideo(outputFile, projectId, sources = []) {
  const id = crypto.randomUUID();
  const videoAbsPath = path.join(outputDir(projectId), outputFile);
  const thumbsDir = path.join(outputDir(projectId), 'thumbnails');
  fs.mkdirSync(thumbsDir, { recursive: true });
  const thumbAbsPath = path.join(thumbsDir, `${id}.jpg`);
  await extractThumbnail(videoAbsPath, thumbAbsPath);

  // Bildgroesse festhalten: der freie Schnitt kann auch quer (16:9) oder
  // quadratisch rendern -- daran haengt beim Upload, ob "#Shorts" angehaengt
  // wird. null, wenn ffprobe nichts liefert (dann entscheidet der Upload wie
  // bisher zugunsten von Shorts).
  const size = await probeSize(videoAbsPath);

  const entry = {
    id,
    filePath: `output/${outputFile}`,
    thumbnailPath: fs.existsSync(thumbAbsPath) ? `output/thumbnails/${id}.jpg` : null,
    width: size ? size.width : null,
    height: size ? size.height : null,
    sources,
    createdAt: new Date().toISOString(),
    youtubeTitle: '',
    youtubeDescription: '',
    tags: [],
    madeForKids: false,
    // YouTubes Angabe "verändertes oder synthetisches Material". Standard aus:
    // die Einschätzung trifft der Nutzer pro Video im Planer.
    containsSyntheticMedia: false,
    scheduledAt: null,
    uploadStatus: 'draft', // draft | uploading | scheduled_on_youtube | error
    youtubeVideoId: null,
    error: null
  };

  const videos = loadVideos(projectId);
  videos.unshift(entry); // neueste zuerst
  saveVideos(videos, projectId);
  return entry;
}

function removeVideo(id, projectId) {
  const videos = loadVideos(projectId);
  const idx = videos.findIndex((video) => video.id === id);
  if (idx === -1) return null;
  const [removed] = videos.splice(idx, 1);
  saveVideos(videos, projectId);
  for (const rel of [removed.filePath, removed.thumbnailPath]) {
    if (!rel) continue;
    const abs = path.join(getProjectDir(projectId), rel);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  }
  return removed;
}

// Fuer den Upload-Planer: Videos aller Projekte, jeweils mit ihrer
// Projekt-Zugehoerigkeit -- geplante Uploads laufen unabhaengig davon weiter,
// welches Projekt gerade im Frontend geoeffnet ist.
function listVideosOfAllProjects() {
  const { projects } = listProjects();
  return projects.flatMap((project) =>
    loadVideos(project.id).map((video) => ({ projectId: project.id, projectName: project.name, video }))
  );
}

module.exports = { loadVideos, saveVideos, collectSources, registerRenderedVideo, removeVideo, listVideosOfAllProjects };

// Bibliothek fertig gerenderter Ranking-Videos, bereit zur Planung/zum
// YouTube-Upload -- getrennt von data/project.json (das beschreibt nur den
// gerade zusammengestellten Clip-Satz, nicht die Historie fertiger Videos).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DATA_DIR } = require('./state');

const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');
const THUMBS_DIR = path.join(OUTPUT_DIR, 'thumbnails');

function ensureFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(VIDEOS_FILE)) {
    fs.writeFileSync(VIDEOS_FILE, '[]', 'utf-8');
  }
}

function loadVideos() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(VIDEOS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveVideos(videos) {
  ensureFile();
  fs.writeFileSync(VIDEOS_FILE, JSON.stringify(videos, null, 2), 'utf-8');
}

function extractThumbnail(videoAbsPath, outAbsPath) {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-y', '-ss', '1', '-i', videoAbsPath, '-frames:v', '1', '-update', '1', outAbsPath]);
    // Thumbnail-Fehler sind nicht kritisch fuers Feature -- einfach ohne
    // Thumbnail weitermachen statt die Registrierung fehlschlagen zu lassen.
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });
}

// Wird von renderer.js nach jedem erfolgreichen Render aufgerufen.
async function registerRenderedVideo(outputFile) {
  const id = crypto.randomUUID();
  const videoAbsPath = path.join(OUTPUT_DIR, outputFile);
  fs.mkdirSync(THUMBS_DIR, { recursive: true });
  const thumbAbsPath = path.join(THUMBS_DIR, `${id}.jpg`);
  await extractThumbnail(videoAbsPath, thumbAbsPath);

  const entry = {
    id,
    filePath: `output/${outputFile}`,
    thumbnailPath: fs.existsSync(thumbAbsPath) ? `output/thumbnails/${id}.jpg` : null,
    createdAt: new Date().toISOString(),
    youtubeTitle: '',
    youtubeDescription: '',
    tags: [],
    madeForKids: false,
    scheduledAt: null,
    uploadStatus: 'draft', // draft | uploading | scheduled_on_youtube | error
    youtubeVideoId: null,
    error: null
  };

  const videos = loadVideos();
  videos.unshift(entry); // neueste zuerst
  saveVideos(videos);
  return entry;
}

function removeVideo(id) {
  const videos = loadVideos();
  const idx = videos.findIndex((v) => v.id === id);
  if (idx === -1) return null;
  const [removed] = videos.splice(idx, 1);
  saveVideos(videos);
  for (const rel of [removed.filePath, removed.thumbnailPath]) {
    if (!rel) continue;
    const abs = path.join(DATA_DIR, rel);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  }
  return removed;
}

module.exports = { loadVideos, saveVideos, registerRenderedVideo, removeVideo, DATA_DIR };

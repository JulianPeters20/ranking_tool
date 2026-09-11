// Kapselt yt-dlp: Metadaten abrufen + Video/Thumbnail herunterladen.
// Ruft die per "npm run setup" heruntergeladene Binary direkt auf (gleiches
// Muster wie ffmpeg in renderer.js) -- kein zusaetzlicher npm-Wrapper.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DATA_DIR } = require('./state');

const BIN_PATH = path.join(
  __dirname, '..', '..', 'bin',
  process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
);
const CLIPS_DIR = path.join(DATA_DIR, 'clips');

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(BIN_PATH)) {
      return reject(new Error('yt-dlp wurde noch nicht heruntergeladen. Bitte zuerst "npm run setup" ausfuehren.'));
    }
    const proc = spawn(BIN_PATH, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`yt-dlp beendet mit Code ${code}:\n${stderr.slice(-2000)}`));
    });
  });
}

async function fetchMetadata(url) {
  const raw = await runYtDlp([url, '--dump-json', '--no-warnings', '--no-playlist']);
  const info = JSON.parse(raw);
  return {
    title: (info.title || info.description || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    duration: typeof info.duration === 'number' ? info.duration : null
  };
}

async function downloadClip(id, url) {
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
  const outputTemplate = path.join(CLIPS_DIR, `${id}.%(ext)s`);

  await runYtDlp([
    url,
    '-f', 'bv*+ba/b',
    '--merge-output-format', 'mp4',
    '--write-thumbnail',
    '--convert-thumbnails', 'jpg',
    '--no-playlist',
    '--no-warnings',
    '-o', outputTemplate
  ]);

  const videoPath = path.join(CLIPS_DIR, `${id}.mp4`);
  const thumbnailPath = path.join(CLIPS_DIR, `${id}.jpg`);

  if (!fs.existsSync(videoPath)) {
    throw new Error('Download abgeschlossen, aber keine mp4-Datei gefunden.');
  }

  return {
    filePath: path.relative(DATA_DIR, videoPath).split(path.sep).join('/'),
    thumbnailPath: fs.existsSync(thumbnailPath)
      ? path.relative(DATA_DIR, thumbnailPath).split(path.sep).join('/')
      : null
  };
}

function removeClipFiles(clip) {
  for (const rel of [clip.filePath, clip.thumbnailPath]) {
    if (!rel) continue;
    const abs = path.join(DATA_DIR, rel);
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
  }
}

module.exports = { fetchMetadata, downloadClip, removeClipFiles };

// Kapselt yt-dlp: Metadaten abrufen + Video/Thumbnail herunterladen.
// Ruft die per "npm run setup" heruntergeladene Binary direkt auf (gleiches
// Muster wie ffmpeg in renderer.js) -- kein zusaetzlicher npm-Wrapper.
// Clips liegen pro Projekt unter data/projects/<id>/clips/.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getProjectDir } = require('./state');

const BIN_PATH = path.join(
  __dirname, '..', '..', 'bin',
  process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
);

function clipsDir(projectId) {
  return path.join(getProjectDir(projectId), 'clips');
}

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

// Die URL steht immer hinter "--": ein Wert wie "--exec=..." wuerde von
// yt-dlp sonst als Option (inkl. Befehlsausfuehrung) interpretiert.
async function fetchMetadata(url) {
  const raw = await runYtDlp(['--dump-json', '--no-warnings', '--no-playlist', '--', url]);
  const info = JSON.parse(raw);
  return {
    title: (info.title || info.description || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    duration: typeof info.duration === 'number' ? info.duration : null
  };
}

async function downloadClip(id, url, projectId) {
  const dir = clipsDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const outputTemplate = path.join(dir, `${id}.%(ext)s`);

  await runYtDlp([
    '-f', 'bv*+ba/b',
    '--merge-output-format', 'mp4',
    '--write-thumbnail',
    '--convert-thumbnails', 'jpg',
    '--no-playlist',
    '--no-warnings',
    '-o', outputTemplate,
    '--',
    url
  ]);

  const videoPath = path.join(dir, `${id}.mp4`);
  const thumbnailPath = path.join(dir, `${id}.jpg`);

  if (!fs.existsSync(videoPath)) {
    throw new Error('Download abgeschlossen, aber keine mp4-Datei gefunden.');
  }

  const projectDir = getProjectDir(projectId);
  return {
    filePath: path.relative(projectDir, videoPath).split(path.sep).join('/'),
    thumbnailPath: fs.existsSync(thumbnailPath)
      ? path.relative(projectDir, thumbnailPath).split(path.sep).join('/')
      : null
  };
}

function removeClipFiles(clip, projectId) {
  for (const rel of [clip.filePath, clip.thumbnailPath]) {
    if (!rel) continue;
    const abs = path.join(getProjectDir(projectId), rel);
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
  }
}

// Entfernt alles, was yt-dlp fuer diese Clip-ID angelegt hat (auch
// .part-/Zwischendateien) -- fuer abgebrochene Downloads und Clips, die
// waehrend des Downloads geloescht wurden.
function removeDownloadedFiles(id, projectId) {
  const dir = clipsDir(projectId);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(`${id}.`)) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
  }
}

module.exports = { fetchMetadata, downloadClip, removeClipFiles, removeDownloadedFiles };

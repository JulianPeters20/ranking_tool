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

// Unterordner im Projekt: 'clips' fuer das Ranking, 'cut' fuer den freien
// Schnitt -- beide Bereiche sollen sich nicht ins Gehege kommen.
function clipsDir(projectId, subdir = 'clips') {
  return path.join(getProjectDir(projectId), subdir);
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

// Urheber des Clips aus den yt-dlp-Metadaten. Welches Feld das Handle
// enthaelt, ist plattformabhaengig (direkt an einem TikTok-Link geprueft):
//   TikTok:  uploader='afvofficial', uploader_id=<Zahl>, uploader_url=Profil
//   YouTube: uploader_id='@handle'
// Deshalb gewinnt uploader_id nur, wenn es wirklich ein Handle ist.
// channel_url wird bewusst nicht genutzt -- TikTok liefert dort eine
// unlesbare Base64-Kennung statt der Profilseite.
function creatorOf(info) {
  const fromId = typeof info.uploader_id === 'string' && info.uploader_id.startsWith('@')
    ? info.uploader_id
    : '';
  const raw = [fromId, info.uploader, info.channel]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find(Boolean);
  if (!raw) return null;
  return {
    handle: (raw.startsWith('@') ? raw : `@${raw}`).slice(0, 80),
    url: typeof info.uploader_url === 'string' && info.uploader_url ? info.uploader_url : null
  };
}

// Die URL steht immer hinter "--": ein Wert wie "--exec=..." wuerde von
// yt-dlp sonst als Option (inkl. Befehlsausfuehrung) interpretiert.
async function fetchMetadata(url) {
  const raw = await runYtDlp(['--dump-json', '--no-warnings', '--no-playlist', '--', url]);
  const info = JSON.parse(raw);
  return {
    title: (info.title || info.description || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    // Auf ganze Sekunden gerundet -- wer es genau braucht (Laengenanzeige,
    // Trimmen), misst die fertige Datei mit probeDuration nach.
    duration: typeof info.duration === 'number' ? info.duration : null,
    creator: creatorOf(info)
  };
}

async function downloadClip(id, url, projectId, subdir = 'clips') {
  const dir = clipsDir(projectId, subdir);
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
function removeDownloadedFiles(id, projectId, subdir = 'clips') {
  const dir = clipsDir(projectId, subdir);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(`${id}.`)) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
  }
}

module.exports = { fetchMetadata, downloadClip, removeClipFiles, removeDownloadedFiles };

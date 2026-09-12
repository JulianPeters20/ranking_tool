// Gemeinsame ffmpeg-/ffprobe-Helfer fuer beide Render-Wege (Ranking-Video und
// freier Schnitt).
//
// ffmpeg wird immer mit dem Projektordner als Arbeitsverzeichnis gestartet:
// ffmpegs drawtext-Optionsparser splittet Werte an ':' -- ein
// Laufwerksbuchstabe wie "D:" in einem Pfad laesst sich weder durch Quotes
// noch durch Backslashes zuverlaessig schuetzen. Mit relativen Pfaden taucht
// gar kein ':' auf.
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { windowsHide: true, cwd: PROJECT_ROOT });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg beendet mit Code ${code}:\n${stderr.slice(-2000)}`));
    });
  });
}

function runFfprobe(args) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', args, { windowsHide: true });
    let stdout = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.on('error', () => resolve(''));
    proc.on('close', () => resolve(stdout.trim()));
  });
}

// Manche Clips (z.B. reine Bild-/Slideshow-Posts) haben keine Tonspur. Ohne
// Ton faehrt ffmpeg ein reines Video-mp4 raus -- das laesst sich spaeter nicht
// per "-c copy" mit den uebrigen Clips (Video+Ton) zusammenhaengen.
async function probeHasAudio(inputPath) {
  const out = await runFfprobe([
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', inputPath
  ]);
  // Ohne ffprobe (leere Ausgabe wegen Fehler) wie bisher Ton annehmen.
  return out.length > 0;
}

async function probeDuration(inputPath) {
  const out = await runFfprobe([
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', inputPath
  ]);
  const duration = Number.parseFloat(out);
  return Number.isFinite(duration) ? duration : null;
}

function toFfmpegPath(p) {
  return p.split(path.sep).join('/');
}

// Pfad relativ zu PROJECT_ROOT (= cwd des ffmpeg-Prozesses).
function toRelativeFfmpegPath(absPath) {
  return toFfmpegPath(path.relative(PROJECT_ROOT, absPath));
}

module.exports = { PROJECT_ROOT, runFfmpeg, runFfprobe, probeHasAudio, probeDuration, toFfmpegPath, toRelativeFfmpegPath };

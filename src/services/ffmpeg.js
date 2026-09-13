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

// Liefert null, wenn ffprobe gar nicht befragt werden konnte (nicht
// installiert, abgestuerzt, Datei unlesbar) -- und die (ggf. leere) Ausgabe,
// wenn ffprobe gelaufen ist. Der Unterschied ist wichtig: "hat keine Tonspur"
// und "konnte nicht nachgeschaut werden" muessen verschieden behandelt werden.
function runFfprobe(args) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', args, { windowsHide: true });
    let stdout = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => resolve(code === 0 ? stdout.trim() : null));
  });
}

// Manche Clips (z.B. reine Bild-/Slideshow-Posts) haben keine Tonspur. Ohne
// Ton faehrt ffmpeg ein reines Video-mp4 raus -- das laesst sich spaeter nicht
// per "-c copy" mit den uebrigen Clips (Video+Ton) zusammenhaengen.
async function probeHasAudio(inputPath) {
  const out = await runFfprobe([
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', inputPath
  ]);
  // Laesst sich die Datei nicht befragen, Ton annehmen: bei "kein Ton" wird
  // eine Stille-Spur ergaenzt und per -map 1:a:0 genutzt -- eine falsche
  // Antwort wuerde den Originalton also stumm ersetzen statt nur zu stoeren.
  if (out === null) return true;
  return out.length > 0;
}

async function probeDuration(inputPath) {
  const out = await runFfprobe([
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', inputPath
  ]);
  const duration = Number.parseFloat(out === null ? '' : out);
  return Number.isFinite(duration) ? duration : null;
}

function toFfmpegPath(p) {
  return p.split(path.sep).join('/');
}

// Pfad relativ zu PROJECT_ROOT (= cwd des ffmpeg-Prozesses).
function toRelativeFfmpegPath(absPath) {
  return toFfmpegPath(path.relative(PROJECT_ROOT, absPath));
}

// Bildgroesse des ersten Videostroms -- entscheidet z.B., ob ein fertiges
// Video hochkant (Shorts) oder quer (klassisches YouTube-Video) ist.
async function probeSize(inputPath) {
  const out = await runFfprobe([
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', inputPath
  ]);
  if (out === null) return null;
  const [width, height] = out.split('x').map((value) => Number.parseInt(value, 10));
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
}

module.exports = { PROJECT_ROOT, runFfmpeg, runFfprobe, probeHasAudio, probeDuration, probeSize, toFfmpegPath, toRelativeFfmpegPath };

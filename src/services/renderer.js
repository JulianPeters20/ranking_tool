// Zwei-Pass-ffmpeg-Rendering:
//  Pass 1: jeden Clip einzeln (im gewaehlten Start/Ende-Ausschnitt) auf
//          1080x1920 normalisieren und einbrennen:
//            - Gesamttitel des Rankings oben (auf jedem Clip identisch),
//              wortweise einfaerbbar, einheitliche Schriftart/-groesse
//            - permanente Rangliste links, nach Rang aufsteigend sortiert
//              (Platz 1 oben, hoechster Platz unten -- wie im Referenz-
//              Template). Der Titel eines Clips erscheint in der Liste,
//              sobald dieser Clip an der Reihe war/ist ("aufgedeckt"); noch
//              nicht gespielte Clips zeigen nur ihre Nummer. Das ist die
//              EINZIGE Stelle, an der ein Clip-Titel angezeigt wird -- es
//              gibt bewusst keine zusaetzliche Einblendung im Video selbst.
//  Pass 2: alle normalisierten Zwischen-Clips verlustfrei aneinanderhaengen
//          (gleiches Format nach Pass 1 -> "-c copy" reicht).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DATA_DIR } = require('./state');
const { resolveTitleFont, DEFAULT_TITLE_FONT_KEY } = require('./fonts');
const { measureWidth } = require('./textMeasure');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');
const TMP_DIR = path.join(OUTPUT_DIR, 'tmp');
// Eigene, ins Projekt kopierte Schriftdateien (statt C:\Windows\Fonts\...):
// ffmpegs drawtext-Optionsparser splittet Werte an ':' *nach* dem Wegfallen
// der Quotes der obersten Filtergraph-Ebene -- ein Laufwerksbuchstabe wie
// "C:" oder "D:" in einem textfile=/fontfile=-Pfad laesst sich daher weder
// durch Quotes noch durch Backslash-Escaping zuverlaessig schuetzen. Der
// zuverlaessige Ausweg: ffmpeg mit cwd=PROJECT_ROOT starten und nur relative
// Pfade (ohne Laufwerksbuchstaben) in den Filter-Optionen verwenden.
// Die Rangliste nutzt immer diese feste Schrift (unabhaengig von der fuer
// den Gesamttitel gewaehlten), damit sie kompakt und einheitlich bleibt.
const LIST_FONT_ABS = resolveTitleFont(DEFAULT_TITLE_FONT_KEY).file;

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const ACCENT_COLOR = '0xFF2D55';
// Plaetze 1-3 immer in Gold/Silber/Bronze (Podium auf einen Blick erkennbar).
const PODIUM_COLORS = { 1: '0xFFD700', 2: '0xC0C0C0', 3: '0xCD7F32' };
// Titel und Liste sitzen bewusst nicht ganz oben: YouTube Shorts blendet am
// oberen Rand Bedienelemente ein, am unteren Rand Kanalname/Beschreibung --
// LIST_BOTTOM_MARGIN haelt die Liste aus diesem Bereich heraus.
const LIST_X = 48;
const LIST_TOP_Y = 360;
const LIST_BOTTOM_MARGIN = 360;
const LIST_SPACING = 108;
const LIST_FONTSIZE = 52;
const LIST_FONTSIZE_ACTIVE = 72;
const LIST_LABEL_MAX_CHARS = 22;

const BANNER_Y = 170;
const BANNER_MAX_WIDTH = 1000;
const BANNER_MIN_FONTSIZE = 26;
const BANNER_DEFAULT_COLOR = '0xFFFFFF';

// Neben den eigentlichen Emoji-Zeichen auch die unsichtbaren Bausteine
// (Hautton-Modifier, Zero-Width-Joiner, Variation Selector, Keycap) entfernen
// -- sonst bleiben davon Kaestchen/Luecken im gerenderten Text uebrig.
const EMOJI_REGEX = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200D\uFE0F\u20E3]/gu;

// Emojis erscheinen nicht im Video (die gebuendelten Schriften haben keine
// Emoji-Glyphen) -- in Rangliste und Gesamttitel werden sie daher entfernt.
function stripEmoji(text) {
  return text.replace(EMOJI_REGEX, '').replace(/\s+/g, ' ').trim();
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trim()}…`;
}

// '#rrggbb' (aus <input type=color>) -> "0xRRGGBB", das Format, das ffmpegs
// fontcolor= erwartet.
function toFfmpegColor(hex) {
  const clean = (hex || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return BANNER_DEFAULT_COLOR;
  return `0x${clean.toUpperCase()}`;
}

let renderState = { status: 'idle', outputFile: null, error: null };

function getRenderStatus() {
  return renderState;
}

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

// Manche Clips (z.B. reine Bild-/Slideshow-Posts) haben keine Tonspur. Ohne
// Ton faehrt ffmpeg ein reines Video-mp4 raus -- das laesst sich im Pass 2
// nicht per "-c copy" mit den uebrigen Clips (Video+Ton) zusammenhaengen.
function probeHasAudio(inputPath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=index',
      '-of', 'csv=p=0',
      inputPath
    ], { windowsHide: true });
    let stdout = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    // Ohne ffprobe wie bisher davon ausgehen, dass Ton vorhanden ist.
    proc.on('error', () => resolve(true));
    proc.on('close', () => resolve(stdout.trim().length > 0));
  });
}

function writeTextFile(dir, name, text) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, text, 'utf-8');
  return filePath;
}

function toFfmpegPath(p) {
  return p.split(path.sep).join('/');
}

// Pfad relativ zu PROJECT_ROOT (= cwd des ffmpeg-Prozesses), damit in den
// drawtext-Filteroptionen kein Laufwerksbuchstabe (":") auftaucht.
function toRelativeFfmpegPath(absPath) {
  return toFfmpegPath(path.relative(PROJECT_ROOT, absPath));
}

// Der gerade laufende Clip wird (neben der groesseren Schrift) in seiner
// Rangfarbe hervorgehoben: Gold/Silber/Bronze fuer Platz 1-3, ab Platz 4
// Akzent-Rot. Nicht aktive Eintraege ab Platz 4 bleiben weiss.
function listEntryColor(rank, isCurrent) {
  if (PODIUM_COLORS[rank]) return PODIUM_COLORS[rank];
  return isCurrent ? ACCENT_COLOR : 'white';
}

// Bis ca. 11 Clips gelten die festen Abstaende/Groessen; bei mehr Clips wird
// die Liste proportional gestaucht, damit sie nicht unten aus dem Bild laeuft.
function listLayout(count) {
  const available = CANVAS_HEIGHT - LIST_TOP_Y - LIST_BOTTOM_MARGIN;
  const spacing = Math.min(LIST_SPACING, Math.floor(available / Math.max(1, count)));
  const scale = spacing / LIST_SPACING;
  return {
    spacing,
    fontsize: Math.max(16, Math.round(LIST_FONTSIZE * scale)),
    fontsizeActive: Math.max(20, Math.round(LIST_FONTSIZE_ACTIVE * scale))
  };
}

// Baut die permanente Rangliste: aufsteigend nach Rang sortiert (Platz 1
// oben), jeder Clip zeigt seinen Titel, sobald er in der Abspielreihenfolge
// an der Reihe war/ist ("aufgedeckt") -- beim letzten Clip ist die Liste
// dadurch vollstaendig gefuellt. Titel koennen beliebigen Text enthalten
// (Kommas, Doppelpunkte, Anfuehrungszeichen ...), daher ueber Textdateien,
// nicht inline text=. expansion=none, weil drawtext sonst '%' im Text als
// Beginn einer %{...}-Sequenz interpretiert ("Stray %" -> falscher Text).
function buildListFilters(clip, allClips) {
  const currentIndex = allClips.findIndex((c) => c.id === clip.id);
  const sortedByRank = [...allClips].sort((a, b) => a.rank - b.rank);
  const fontFileRel = toRelativeFfmpegPath(LIST_FONT_ABS);
  const layout = listLayout(allClips.length);

  return sortedByRank.map((listClip, displayIndex) => {
    const originalIndex = allClips.findIndex((c) => c.id === listClip.id);
    const isCurrent = listClip.id === clip.id;
    const revealed = originalIndex <= currentIndex;

    let label = `${listClip.rank}.`;
    if (revealed) {
      const clean = stripEmoji((listClip.title || '').trim());
      if (clean) label += ` ${truncate(clean, LIST_LABEL_MAX_CHARS)}`;
    }

    const labelFile = writeTextFile(TMP_DIR, `${clip.id}_list${displayIndex}.txt`, label);
    const labelFileRel = toRelativeFfmpegPath(labelFile);

    const fontsize = isCurrent ? layout.fontsizeActive : layout.fontsize;
    const fontcolor = listEntryColor(listClip.rank, isCurrent);
    const y = LIST_TOP_Y + displayIndex * layout.spacing;

    return `drawtext=textfile=${labelFileRel}:expansion=none:fontfile=${fontFileRel}:fontsize=${fontsize}:fontcolor=${fontcolor}:borderw=4:bordercolor=black:x=${LIST_X}:y=${y}`;
  });
}

// Baut den Gesamttitel: jedes Wort ein eigener drawtext-Filter (gleiche
// Schriftart/-groesse fuer alle, aber individuell einfaerbbar), von Hand
// nebeneinander positioniert. ffmpeg kann die berechnete Breite eines
// drawtext-Filters keinem anderen Filter zur Verfuegung stellen, daher
// messen wir die Wortbreiten selbst (opentype.js, exakte Font-Metriken) und
// rechnen die x-Position jedes Worts sowie die Gesamtbreite fuer die
// Zentrierung/Hintergrundbox aus. Wird einmal pro Render aufgerufen (der
// Titel ist auf jedem Clip identisch) und das Ergebnis fuer alle Clips
// wiederverwendet.
function buildTitleFilters(settings) {
  const rawTitle = (settings.title || '').trim();
  if (!rawTitle) return [];

  // Der Wortindex muss dem im Frontend entsprechen (Schluessel von
  // titleWordColors) -- daher erst splitten, dann Emojis pro Wort entfernen
  // und reine Emoji-"Woerter" auslassen, ohne die Indizes zu verschieben.
  const words = rawTitle
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => ({ text: stripEmoji(word), index }))
    .filter((w) => w.text);
  if (words.length === 0) return [];

  const fontFile = resolveTitleFont(settings.titleFont).file;
  const fontFileRel = toRelativeFfmpegPath(fontFile);
  const wordColors = settings.titleWordColors || {};

  let fontSize = Number(settings.titleFontSize) > 0 ? Number(settings.titleFontSize) : 62;

  const measureTotal = (size) => {
    const spaceW = measureWidth(fontFile, ' ', size);
    const wordsW = words.reduce((sum, w) => sum + measureWidth(fontFile, w.text, size), 0);
    return wordsW + spaceW * (words.length - 1);
  };

  let totalWidth = measureTotal(fontSize);
  if (totalWidth > BANNER_MAX_WIDTH) {
    const scale = BANNER_MAX_WIDTH / totalWidth;
    fontSize = Math.max(BANNER_MIN_FONTSIZE, Math.floor(fontSize * scale));
    totalWidth = measureTotal(fontSize);
  }

  const spaceWidth = measureWidth(fontFile, ' ', fontSize);
  const startX = Math.max(16, Math.round((CANVAS_WIDTH - totalWidth) / 2));

  const boxPaddingX = 24;
  const boxPaddingY = 18;
  const boxHeight = Math.round(fontSize * 1.25) + boxPaddingY * 2;
  const boxY = Math.max(0, BANNER_Y - boxPaddingY);
  const boxX = Math.max(0, Math.round(startX - boxPaddingX));
  const boxWidth = Math.min(CANVAS_WIDTH, Math.round(totalWidth + boxPaddingX * 2));

  const filters = [
    `drawbox=x=${boxX}:y=${boxY}:w=${boxWidth}:h=${boxHeight}:color=black@0.55:t=fill`
  ];

  let cursorX = startX;
  for (const word of words) {
    const wordFile = writeTextFile(TMP_DIR, `banner_word_${word.index}.txt`, word.text);
    const wordFileRel = toRelativeFfmpegPath(wordFile);
    const colorHex = wordColors[String(word.index)];
    const fontcolor = colorHex ? toFfmpegColor(colorHex) : BANNER_DEFAULT_COLOR;

    filters.push(
      `drawtext=textfile=${wordFileRel}:expansion=none:fontfile=${fontFileRel}:fontsize=${fontSize}:fontcolor=${fontcolor}:borderw=4:bordercolor=black:x=${Math.round(cursorX)}:y=${BANNER_Y}`
    );

    cursorX += measureWidth(fontFile, word.text, fontSize) + spaceWidth;
  }

  return filters;
}

async function renderSingleClip(clip, allClips, titleFilters) {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const inputPath = path.join(DATA_DIR, clip.filePath);
  const outputPath = path.join(TMP_DIR, `${clip.id}.mp4`);

  // setsar/format: alle Zwischen-Clips muessen exakt dasselbe Format haben,
  // sonst scheitert bzw. verfaelscht der verlustfreie Concat in Pass 2
  // (z.B. bei Quellen mit nicht-quadratischen Pixeln oder 10-Bit/4:4:4).
  const filters = [
    `scale=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
    ...titleFilters,
    ...buildListFilters(clip, allClips),
    'format=yuv420p'
  ];

  const trimStart = Number(clip.trimStart) > 0 ? Number(clip.trimStart) : 0;
  const trimEnd = clip.trimEnd !== null && clip.trimEnd !== undefined ? Number(clip.trimEnd) : null;
  const trimArgs = [];
  if (trimStart > 0) {
    trimArgs.push('-ss', String(trimStart));
  }
  // ffmpeg bricht mit "-to value smaller than -ss" ab -- ein ungueltiges Ende
  // bedeutet daher "bis zum Clipende".
  if (trimEnd !== null && Number.isFinite(trimEnd) && trimEnd > trimStart) {
    trimArgs.push('-to', String(trimEnd));
  }

  const hasAudio = await probeHasAudio(inputPath);
  const inputArgs = [...trimArgs, '-i', inputPath];
  if (!hasAudio) {
    inputArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }

  await runFfmpeg([
    '-y',
    ...inputArgs,
    '-map', '0:v:0',
    '-map', hasAudio ? '0:a:0' : '1:a:0',
    '-vf', filters.join(','),
    '-r', '30',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', 'aac',
    '-ar', '44100',
    '-ac', '2',
    ...(hasAudio ? [] : ['-shortest']),
    outputPath
  ]);

  return outputPath;
}

async function concatClips(tmpFiles) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const listPath = path.join(TMP_DIR, 'concat_list.txt');
  const listContent = tmpFiles
    .map((f) => `file '${toFfmpegPath(f)}'`)
    .join('\n');
  fs.writeFileSync(listPath, listContent, 'utf-8');

  const outputFile = `final_${Date.now()}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputFile);

  await runFfmpeg([
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    // moov-Atom an den Dateianfang -> Browser-Vorschau startet sofort.
    '-movflags', '+faststart',
    outputPath
  ]);

  return outputFile;
}

// Zwischen-Clips/Textdateien werden nach jedem Render entfernt -- sonst
// sammeln sich pro Render zig MB in data/output/tmp an (und sind ueber die
// statische /output-Route erreichbar).
function cleanupTmpDir() {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // Aufraeumen ist nicht kritisch -- beim naechsten Render erneut versucht.
  }
}

function startRender(clipsWithRank, settings) {
  renderState = { status: 'running', outputFile: null, error: null };

  (async () => {
    try {
      cleanupTmpDir();
      fs.mkdirSync(TMP_DIR, { recursive: true });

      // Der Gesamttitel ist auf jedem Clip identisch -- Filter einmalig
      // berechnen (inkl. Font-Metriken-Messung) und fuer alle Clips
      // wiederverwenden statt N Mal neu zu bauen.
      const titleFilters = buildTitleFilters(settings);

      const tmpFiles = [];
      for (const clip of clipsWithRank) {
        const tmpFile = await renderSingleClip(clip, clipsWithRank, titleFilters);
        tmpFiles.push(tmpFile);
      }
      const outputFile = await concatClips(tmpFiles);
      // Fertiges Video in die Bibliothek fuer den YouTube-Planer aufnehmen,
      // bevor der Status auf "done" springt -- so ist es beim Wechsel in den
      // Planer garantiert schon gelistet. Spaeter require'd (nicht am
      // Dateikopf), um einen Zirkelbezug zu vermeiden, falls videoLibrary.js
      // je etwas aus renderer.js braucht.
      await require('./videoLibrary').registerRenderedVideo(outputFile).catch((err) => {
        console.error('Video konnte nicht in die Planer-Bibliothek aufgenommen werden:', err);
      });
      renderState = { status: 'done', outputFile, error: null };
    } catch (err) {
      renderState = { status: 'error', outputFile: null, error: String(err.message || err) };
    } finally {
      cleanupTmpDir();
    }
  })();
}

module.exports = { startRender, getRenderStatus };

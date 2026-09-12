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
//            - Emojis in Titeln als farbige Bilder (siehe emoji.js)
//  Pass 2: alle normalisierten Zwischen-Clips verlustfrei aneinanderhaengen
//          (gleiches Format nach Pass 1 -> "-c copy" reicht).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getProjectDir } = require('./state');
const { resolveTitleFont, DEFAULT_TITLE_FONT_KEY } = require('./fonts');
const { measureWidth, capHeight } = require('./textMeasure');
const { graphemes, segmentText, resolveEmojiImages } = require('./emoji');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
// Pfade des gerade gerenderten Projekts. Es laeuft immer nur ein Render
// gleichzeitig (POST /api/render lehnt Parallelstarts ab), daher reichen
// Modul-Variablen, die startRender() zu Beginn setzt.
let projectDir = null;
let outputDir = null;
let tmpDir = null;

function setProjectPaths(projectId) {
  projectDir = getProjectDir(projectId);
  outputDir = path.join(projectDir, 'output');
  tmpDir = path.join(outputDir, 'tmp');
}
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

// Emoji-Bilder: Kantenlaenge relativ zur Schriftgroesse, Abstand danach und
// wie weit sie (wie Emoji-Glyphen in Schriften) unter die Grundlinie reichen.
const EMOJI_SIZE_RATIO = 1.05;
const EMOJI_GAP_RATIO = 0.08;
const EMOJI_BELOW_BASELINE_RATIO = 0.12;

// Zaehlt Grapheme statt UTF-16-Einheiten, damit ein Emoji nicht mittendrin
// abgeschnitten wird.
function truncate(text, maxChars) {
  const chars = graphemes(text);
  if (chars.length <= maxChars) return text;
  return `${chars.slice(0, maxChars - 1).join('').trim()}…`;
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

function emojiMetrics(fontSize) {
  const size = Math.round(fontSize * EMOJI_SIZE_RATIO);
  return { size, advance: size + Math.round(fontSize * EMOJI_GAP_RATIO) };
}

// Breite einer Folge aus Text- und Emoji-Stuecken. Nicht verfuegbare Emojis
// (Bild fehlt) werden weggelassen und zaehlen daher nicht mit.
function measureSegments(segments, fontFile, fontSize, emojiImages) {
  const { advance } = emojiMetrics(fontSize);
  return segments.reduce((sum, seg) => {
    if (seg.emoji) return sum + (emojiImages.get(seg.text) ? advance : 0);
    return sum + measureWidth(fontFile, seg.text, fontSize);
  }, 0);
}

// Setzt Text- und Emoji-Stuecke nebeneinander auf eine gemeinsame
// Grundlinie: Text als drawtext (y_align=baseline), Emojis als Overlay-Bild.
// Text kommt ueber Textdateien (beliebige Zeichen wie Kommas, Doppelpunkte,
// Anfuehrungszeichen), expansion=none, weil drawtext sonst '%' als Beginn
// einer %{...}-Sequenz interpretiert ("Stray %" -> falscher Text).
function layoutSegments({ segments, fontFile, fontSize, color, x, baselineY, emojiImages, filePrefix, borderw }) {
  const fontFileRel = toRelativeFfmpegPath(fontFile);
  const emoji = emojiMetrics(fontSize);
  const drawtexts = [];
  const overlays = [];
  let cursorX = x;

  segments.forEach((seg, i) => {
    if (seg.emoji) {
      const file = emojiImages.get(seg.text);
      if (!file) return;
      overlays.push({
        file,
        size: emoji.size,
        x: Math.round(cursorX),
        y: Math.round(baselineY - emoji.size * (1 - EMOJI_BELOW_BASELINE_RATIO))
      });
      cursorX += emoji.advance;
      return;
    }
    if (seg.text.trim()) {
      const textFile = writeTextFile(tmpDir, `${filePrefix}_${i}.txt`, seg.text);
      drawtexts.push(
        `drawtext=textfile=${toRelativeFfmpegPath(textFile)}:expansion=none:fontfile=${fontFileRel}:fontsize=${fontSize}:fontcolor=${color}:borderw=${borderw}:bordercolor=black:x=${Math.round(cursorX)}:y=${Math.round(baselineY)}:y_align=baseline`
      );
    }
    cursorX += measureWidth(fontFile, seg.text, fontSize);
  });

  return { drawtexts, overlays };
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
// dadurch vollstaendig gefuellt.
function buildListLayers(clip, allClips, emojiImages) {
  const currentIndex = allClips.findIndex((c) => c.id === clip.id);
  const sortedByRank = [...allClips].sort((a, b) => a.rank - b.rank);
  const layout = listLayout(allClips.length);
  const drawtexts = [];
  const overlays = [];

  sortedByRank.forEach((listClip, displayIndex) => {
    const originalIndex = allClips.findIndex((c) => c.id === listClip.id);
    const isCurrent = listClip.id === clip.id;
    const revealed = originalIndex <= currentIndex;

    let label = `${listClip.rank}.`;
    if (revealed) {
      const title = (listClip.title || '').replace(/\s+/g, ' ').trim();
      if (title) label += ` ${truncate(title, LIST_LABEL_MAX_CHARS)}`;
    }

    const fontSize = isCurrent ? layout.fontsizeActive : layout.fontsize;
    const topY = LIST_TOP_Y + displayIndex * layout.spacing;
    const layers = layoutSegments({
      segments: segmentText(label),
      fontFile: LIST_FONT_ABS,
      fontSize,
      color: listEntryColor(listClip.rank, isCurrent),
      x: LIST_X,
      baselineY: topY + capHeight(LIST_FONT_ABS, fontSize),
      emojiImages,
      filePrefix: `${clip.id}_list${displayIndex}`,
      borderw: 4
    });
    drawtexts.push(...layers.drawtexts);
    overlays.push(...layers.overlays);
  });

  return { drawtexts, overlays };
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
function buildTitleLayers(settings, emojiImages) {
  const empty = { drawtexts: [], overlays: [] };
  const rawTitle = (settings.title || '').trim();
  if (!rawTitle) return empty;

  const fontFile = resolveTitleFont(settings.titleFont).file;
  const wordColors = settings.titleWordColors || {};

  // Der Wortindex muss dem im Frontend entsprechen (Schluessel von
  // titleWordColors); Woerter, von denen nichts darstellbar ist (z.B. ein
  // Emoji ohne verfuegbares Bild), fallen weg, ohne die Indizes zu verschieben.
  const words = rawTitle
    .split(/\s+/)
    .filter(Boolean)
    .map((text, index) => ({ segments: segmentText(text), index }));

  let fontSize = Number(settings.titleFontSize) > 0 ? Number(settings.titleFontSize) : 62;

  const measureAll = (size) => {
    const visible = words
      .map((w) => ({ ...w, width: measureSegments(w.segments, fontFile, size, emojiImages) }))
      .filter((w) => w.width > 0);
    const spaceW = measureWidth(fontFile, ' ', size);
    const total = visible.reduce((sum, w) => sum + w.width, 0) + spaceW * Math.max(0, visible.length - 1);
    return { visible, total, spaceW };
  };

  let measured = measureAll(fontSize);
  if (measured.visible.length === 0) return empty;
  if (measured.total > BANNER_MAX_WIDTH) {
    fontSize = Math.max(BANNER_MIN_FONTSIZE, Math.floor(fontSize * (BANNER_MAX_WIDTH / measured.total)));
    measured = measureAll(fontSize);
  }

  const startX = Math.max(16, Math.round((CANVAS_WIDTH - measured.total) / 2));
  const boxPaddingX = 24;
  const boxPaddingY = 18;
  const boxHeight = Math.round(fontSize * 1.25) + boxPaddingY * 2;
  const boxY = Math.max(0, BANNER_Y - boxPaddingY);
  const boxX = Math.max(0, Math.round(startX - boxPaddingX));
  const boxWidth = Math.min(CANVAS_WIDTH, Math.round(measured.total + boxPaddingX * 2));

  const drawtexts = [
    `drawbox=x=${boxX}:y=${boxY}:w=${boxWidth}:h=${boxHeight}:color=black@0.55:t=fill`
  ];
  const overlays = [];
  const baselineY = BANNER_Y + capHeight(fontFile, fontSize);

  let cursorX = startX;
  for (const word of measured.visible) {
    const colorHex = wordColors[String(word.index)];
    const layers = layoutSegments({
      segments: word.segments,
      fontFile,
      fontSize,
      color: colorHex ? toFfmpegColor(colorHex) : BANNER_DEFAULT_COLOR,
      x: cursorX,
      baselineY,
      emojiImages,
      filePrefix: `banner_word_${word.index}`,
      borderw: 4
    });
    drawtexts.push(...layers.drawtexts);
    overlays.push(...layers.overlays);
    cursorX += word.width + measured.spaceW;
  }

  return { drawtexts, overlays };
}

async function renderSingleClip(clip, allClips, titleLayers, emojiImages) {
  fs.mkdirSync(tmpDir, { recursive: true });

  const inputPath = path.join(projectDir, clip.filePath);
  const outputPath = path.join(tmpDir, `${clip.id}.mp4`);
  const listLayers = buildListLayers(clip, allClips, emojiImages);

  // setsar/format: alle Zwischen-Clips muessen exakt dasselbe Format haben,
  // sonst scheitert bzw. verfaelscht der verlustfreie Concat in Pass 2
  // (z.B. bei Quellen mit nicht-quadratischen Pixeln oder 10-Bit/4:4:4).
  const baseChain = [
    `scale=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
    ...titleLayers.drawtexts,
    ...listLayers.drawtexts
  ].join(',');

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

  // Jedes Emoji-Bild ist ein eigener Eingang, wird auf seine Groesse skaliert
  // und per overlay aufgelegt (ein Einzelbild bleibt dabei ueber die ganze
  // Clipdauer stehen -- overlay wiederholt standardmaessig das letzte Bild).
  const overlays = [...titleLayers.overlays, ...listLayers.overlays];
  const firstEmojiInput = hasAudio ? 1 : 2;
  let graph = `[0:v]${baseChain}[v0]`;
  overlays.forEach((o, i) => {
    inputArgs.push('-i', o.file);
    graph += `;[${firstEmojiInput + i}:v]scale=${o.size}:${o.size}[e${i}]`;
    graph += `;[v${i}][e${i}]overlay=x=${o.x}:y=${o.y}[v${i + 1}]`;
  });
  graph += `;[v${overlays.length}]format=yuv420p[vout]`;

  await runFfmpeg([
    '-y',
    ...inputArgs,
    '-filter_complex', graph,
    '-map', '[vout]',
    '-map', hasAudio ? '0:a:0' : '1:a:0',
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
  fs.mkdirSync(outputDir, { recursive: true });
  const listPath = path.join(tmpDir, 'concat_list.txt');
  const listContent = tmpFiles
    .map((f) => `file '${toFfmpegPath(f)}'`)
    .join('\n');
  fs.writeFileSync(listPath, listContent, 'utf-8');

  const outputFile = `final_${Date.now()}.mp4`;
  const outputPath = path.join(outputDir, outputFile);

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
  if (!tmpDir) return; // vor dem ersten Render noch kein Projekt gesetzt
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Aufraeumen ist nicht kritisch -- beim naechsten Render erneut versucht.
  }
}

function startRender(clipsWithRank, settings, projectId) {
  setProjectPaths(projectId);
  renderState = { status: 'running', outputFile: null, error: null, projectId };

  (async () => {
    try {
      cleanupTmpDir();
      fs.mkdirSync(tmpDir, { recursive: true });

      // Alle benoetigten Emoji-Bilder vorab besorgen (Cache oder Download).
      const emojiImages = await resolveEmojiImages([
        settings.title,
        ...clipsWithRank.map((c) => c.title)
      ]);

      // Der Gesamttitel ist auf jedem Clip identisch -- einmalig berechnen
      // (inkl. Font-Metriken-Messung) und fuer alle Clips wiederverwenden.
      const titleLayers = buildTitleLayers(settings, emojiImages);

      const tmpFiles = [];
      for (const clip of clipsWithRank) {
        const tmpFile = await renderSingleClip(clip, clipsWithRank, titleLayers, emojiImages);
        tmpFiles.push(tmpFile);
      }
      const outputFile = await concatClips(tmpFiles);
      // Fertiges Video in die Bibliothek fuer den YouTube-Planer aufnehmen,
      // bevor der Status auf "done" springt -- so ist es beim Wechsel in den
      // Planer garantiert schon gelistet. Spaeter require'd (nicht am
      // Dateikopf), um einen Zirkelbezug zu vermeiden, falls videoLibrary.js
      // je etwas aus renderer.js braucht.
      await require('./videoLibrary').registerRenderedVideo(outputFile, projectId).catch((err) => {
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

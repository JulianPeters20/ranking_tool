// Freier Schnitt: beliebige Clips aneinanderhaengen, ohne Ranking-Overlay.
// Gleiches Zwei-Pass-Prinzip wie beim Ranking-Video:
//   Pass 1: jeden Clip im gewaehlten Ausschnitt auf das Zielformat
//           normalisieren (gleiche Groesse, SAR, Bildrate, Tonformat)
//   Pass 2: verlustfrei zusammenhaengen ("-c copy")
//   Pass 3 (optional): Musik und/oder vorgelesenen Text untermischen
const fs = require('fs');
const path = require('path');
const { getProjectDir } = require('./state');
const { runFfmpeg, probeHasAudio, toFfmpegPath } = require('./ffmpeg');
const { setRenderStatus } = require('./renderState');

const FORMATS = {
  portrait: { width: 1080, height: 1920, label: 'Hochkant 9:16 (Shorts, Reels, TikTok)' },
  landscape: { width: 1920, height: 1080, label: 'Quer 16:9 (klassisches YouTube-Video)' },
  square: { width: 1080, height: 1080, label: 'Quadratisch 1:1' }
};

function formatOf(name) {
  return FORMATS[name] || FORMATS.portrait;
}

function cutDir(projectId) {
  return path.join(getProjectDir(projectId), 'cut');
}

function tmpDirOf(projectId) {
  return path.join(getProjectDir(projectId), 'output', 'cut-tmp');
}

// Ein Clip -> normalisierte Zwischendatei. Fehlt die Tonspur, wird Stille
// ergaenzt, sonst scheitert das verlustfreie Zusammenhaengen in Pass 2.
async function normalizeClip(clip, format, projectId, index) {
  const projectDir = getProjectDir(projectId);
  const inputPath = path.join(projectDir, clip.filePath);
  const outputPath = path.join(tmpDirOf(projectId), `cut_${String(index).padStart(3, '0')}.mp4`);

  const trimStart = Number(clip.trimStart) > 0 ? Number(clip.trimStart) : 0;
  const trimEnd = clip.trimEnd !== null && clip.trimEnd !== undefined ? Number(clip.trimEnd) : null;
  const trimArgs = [];
  if (trimStart > 0) trimArgs.push('-ss', String(trimStart));
  // ffmpeg bricht mit "-to value smaller than -ss" ab -- ein ungueltiges Ende
  // bedeutet daher "bis zum Clipende".
  if (trimEnd !== null && Number.isFinite(trimEnd) && trimEnd > trimStart) trimArgs.push('-to', String(trimEnd));

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
    '-vf', [
      `scale=${format.width}:${format.height}:force_original_aspect_ratio=decrease`,
      `pad=${format.width}:${format.height}:(ow-iw)/2:(oh-ih)/2`,
      'setsar=1',
      'format=yuv420p'
    ].join(','),
    '-r', '30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    ...(hasAudio ? [] : ['-shortest']),
    outputPath
  ]);

  return outputPath;
}

async function concatClips(tmpFiles, projectId) {
  const listPath = path.join(tmpDirOf(projectId), 'concat_list.txt');
  fs.writeFileSync(listPath, tmpFiles.map((file) => `file '${toFfmpegPath(file)}'`).join('\n'), 'utf-8');

  const outputPath = path.join(tmpDirOf(projectId), 'joined.mp4');
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath]);
  return outputPath;
}

// Mischt Musik (in Schleife) und/oder die vorgelesene Stimme unter den
// Originalton. Das Video wird dabei nur durchgereicht ("-c:v copy").
async function mixAudio(videoPath, cut, projectId, outputPath) {
  const projectDir = getProjectDir(projectId);
  const inputs = ['-i', videoPath];
  const filters = [`[0:a]volume=${Number(cut.clipVolume ?? 1)}[a0]`];
  const mixLabels = ['[a0]'];
  let index = 1;

  if (cut.music && cut.music.filePath) {
    // -stream_loop -1: kurze Musik laeuft bis zum Videoende weiter.
    inputs.push('-stream_loop', '-1', '-i', path.join(projectDir, cut.music.filePath));
    filters.push(`[${index}:a]volume=${Number(cut.music.volume ?? 0.15)}[am]`);
    mixLabels.push('[am]');
    index += 1;
  }

  if (cut.voice && cut.voice.filePath) {
    inputs.push('-i', path.join(projectDir, cut.voice.filePath));
    // Die Stimme startet am Videoanfang und bleibt unveraendert laut.
    filters.push(`[${index}:a]volume=${Number(cut.voice.volume ?? 1)},apad[av]`);
    mixLabels.push('[av]');
    index += 1;
  }

  // duration=first: die Laenge richtet sich nach dem Video, nicht nach Musik
  // oder Stimme.
  // normalize=0: amix teilt sonst jeden Eingang durch deren Anzahl -- mit
  // Musik waere der Originalton nur noch halb, mit Musik UND Stimme ein
  // Drittel so laut, egal was oben als Lautstaerke eingestellt ist (gemessen:
  // -21,1 dB allein gegen -27,0 dB mit Musik). Gegen Uebersteuerung schuetzt
  // der alimiter dahinter, nicht das Herunterrechnen.
  filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`);

  await runFfmpeg([
    '-y',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '0:v:0',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    outputPath
  ]);
}

function cleanupTmp(projectId) {
  try {
    fs.rmSync(tmpDirOf(projectId), { recursive: true, force: true });
  } catch {
    // Aufraeumen ist nicht kritisch -- beim naechsten Render erneut versucht.
  }
}

function startCutRender(cut, projectId) {
  setRenderStatus({ status: 'running', kind: 'cut', outputFile: null, error: null, projectId });

  (async () => {
    try {
      cleanupTmp(projectId);
      fs.mkdirSync(tmpDirOf(projectId), { recursive: true });
      const outputDir = path.join(getProjectDir(projectId), 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      const format = formatOf(cut.format);
      const tmpFiles = [];
      for (const [index, clip] of cut.clips.entries()) {
        tmpFiles.push(await normalizeClip(clip, format, projectId, index));
      }

      const joined = await concatClips(tmpFiles, projectId);
      const outputFile = `cut_${Date.now()}.mp4`;
      const outputPath = path.join(outputDir, outputFile);

      const hasExtraAudio = (cut.music && cut.music.filePath) || (cut.voice && cut.voice.filePath);
      if (hasExtraAudio) {
        await mixAudio(joined, cut, projectId, outputPath);
      } else {
        await runFfmpeg(['-y', '-i', joined, '-c', 'copy', '-movflags', '+faststart', outputPath]);
      }

      // Fertiges Video in dieselbe Bibliothek wie die Ranking-Videos legen --
      // der YouTube-Planer arbeitet damit unveraendert weiter.
      const videoLibrary = require('./videoLibrary');
      await videoLibrary.registerRenderedVideo(
        outputFile,
        projectId,
        videoLibrary.collectSources(cut.clips)
      ).catch((err) => {
        console.error('Video konnte nicht in die Planer-Bibliothek aufgenommen werden:', err);
      });
      setRenderStatus({ status: 'done', kind: 'cut', outputFile, error: null });
    } catch (err) {
      setRenderStatus({ status: 'error', kind: 'cut', outputFile: null, error: String(err.message || err) });
    } finally {
      cleanupTmp(projectId);
    }
  })();
}

module.exports = { startCutRender, FORMATS, cutDir };

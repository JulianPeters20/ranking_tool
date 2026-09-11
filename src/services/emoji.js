// Farbige Emojis im Video: ffmpegs drawtext zeichnet Emoji-Glyphen nur
// einfarbig in der Schriftfarbe (getestet mit Segoe UI Emoji -> weisse
// Umrisse). Emojis werden deshalb als Bilder (Google Noto Emoji, Apache-2.0)
// ueber das Video gelegt. Die PNGs werden beim ersten Gebrauch einmalig
// heruntergeladen und in data/emoji-cache zwischengespeichert -- danach
// funktioniert das Rendern auch offline.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./state');

const CACHE_DIR = path.join(DATA_DIR, 'emoji-cache');
const SOURCE_URL = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/png/128/';
const DOWNLOAD_TIMEOUT_MS = 10000;

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const EMOJI_CHAR = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
// Tastenkappen-Emojis (z.B. 1️⃣) bestehen aus einer Ziffer plus diesem
// Kombinationszeichen -- die Ziffer selbst hat keine Emoji-Eigenschaft.
const KEYCAP = String.fromCodePoint(0x20e3);

function isEmojiCluster(cluster) {
  return EMOJI_CHAR.test(cluster) || cluster.includes(KEYCAP);
}

// Zerlegt in Grapheme (vom Nutzer wahrgenommene Zeichen) -- ein Emoji mit
// Hautton oder eine ZWJ-Sequenz wie 👨‍👩‍👧 zaehlt so als EIN Zeichen.
function graphemes(text) {
  return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
}

// Text -> abwechselnde Stuecke [{ emoji: false, text: 'Platz ' }, { emoji: true, text: '🐶' }, ...]
function segmentText(text) {
  const segments = [];
  for (const cluster of graphemes(text || '')) {
    const emoji = isEmojiCluster(cluster);
    const last = segments[segments.length - 1];
    if (!emoji && last && !last.emoji) {
      last.text += cluster;
    } else {
      segments.push({ emoji, text: cluster });
    }
  }
  return segments;
}

// Dateinamen-Schema von Noto: Codepoints als Hex, mit "_" verbunden, ohne
// Variation Selector FE0F (z.B. ❤️ -> emoji_u2764.png, 👍🏽 -> emoji_u1f44d_1f3fd.png).
function notoFileName(cluster) {
  const codepoints = [...cluster]
    .map((ch) => ch.codePointAt(0))
    .filter((cp) => cp !== 0xfe0f)
    .map((cp) => cp.toString(16));
  return `emoji_u${codepoints.join('_')}.png`;
}

async function download(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) return;
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, dest);
}

// Liefert fuer jedes in den Texten vorkommende Emoji den Pfad zu seinem PNG
// (oder null, wenn es nicht verfuegbar ist -- z.B. offline beim ersten Mal
// oder ein Emoji, das Noto nicht kennt; es wird dann einfach weggelassen).
async function resolveEmojiImages(texts) {
  const clusters = new Set();
  for (const text of texts) {
    for (const segment of segmentText(text)) {
      if (segment.emoji) clusters.add(segment.text);
    }
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const images = new Map();
  await Promise.all([...clusters].map(async (cluster) => {
    const fileName = notoFileName(cluster);
    const file = path.join(CACHE_DIR, fileName);
    if (!fs.existsSync(file)) {
      try {
        await download(SOURCE_URL + fileName, file);
      } catch (err) {
        console.warn(`Emoji ${cluster} konnte nicht geladen werden: ${err.message}`);
      }
    }
    images.set(cluster, fs.existsSync(file) ? file : null);
  }));
  return images;
}

module.exports = { graphemes, segmentText, resolveEmojiImages };

// Praezise Textbreiten-Messung ueber die echten Font-Metriken (opentype.js,
// reines JS, keine nativen Abhaengigkeiten) -- ersetzt die bisherige grobe
// Zeichenbreiten-Schaetzung. Noetig, um mehrere Woerter mit unterschiedlichen
// Farben in EINER Zeile korrekt nebeneinander zu positionieren (jedes Wort
// ist ein eigener drawtext-Filter, ffmpeg kann deren Breiten nicht
// untereinander austauschen -- wir berechnen die x-Positionen daher selbst).
const fs = require('fs');
const opentype = require('opentype.js');

const fontCache = new Map();

function loadFont(fontFilePath) {
  if (fontCache.has(fontFilePath)) return fontCache.get(fontFilePath);
  const nodeBuffer = fs.readFileSync(fontFilePath);
  // .buffer kann bei kleinen Dateien aus Nodes Buffer-Pool stammen und groesser
  // sein als die Datei selbst -- byteOffset/byteLength schneiden exakt zu.
  const arrayBuffer = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
  const font = opentype.parse(arrayBuffer);
  fontCache.set(fontFilePath, font);
  return font;
}

// Fallback ohne OpenType-Feature-Verarbeitung: Glyph-Vorschubbreiten plus
// Kerning-Paare direkt aufsummieren.
function measureWidthSimple(font, text, fontSize) {
  const scale = fontSize / font.unitsPerEm;
  let width = 0;
  let previous = null;
  for (const char of text) {
    const glyph = font.charToGlyph(char);
    if (previous) width += font.getKerningValue(previous, glyph) * scale;
    width += (glyph.advanceWidth || 0) * scale;
    previous = glyph;
  }
  return width;
}

function measureWidth(fontFilePath, text, fontSize) {
  const font = loadFont(fontFilePath);
  try {
    return font.getAdvanceWidth(text, fontSize);
  } catch {
    // opentype.js unterstuetzt nicht alle GSUB-Lookup-Typen und wirft dann
    // (z.B. Bahnschrift: "lookupType: 6 - substFormat: 2 is not yet
    // supported") -- ohne Fallback bricht das komplette Rendering ab.
    return measureWidthSimple(font, text, fontSize);
  }
}

// Hoehe der Grossbuchstaben in px. Text wird mit drawtext y_align=baseline
// auf eine gemeinsame Grundlinie gesetzt (noetig, damit Textstuecke und
// Emoji-Bilder buendig stehen); die Layout-Konstanten beschreiben aber die
// Oberkante der Schrift -- Oberkante + Versalhoehe = Grundlinie.
function capHeight(fontFilePath, fontSize) {
  const font = loadFont(fontFilePath);
  const os2 = font.tables.os2;
  const units = os2 && os2.sCapHeight ? os2.sCapHeight : font.unitsPerEm * 0.72;
  return (units / font.unitsPerEm) * fontSize;
}

module.exports = { measureWidth, capHeight };

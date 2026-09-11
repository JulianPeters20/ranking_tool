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

function measureWidth(fontFilePath, text, fontSize) {
  return loadFont(fontFilePath).getAdvanceWidth(text, fontSize);
}

module.exports = { measureWidth };

// Auswahl an lokal gebuendelten Schriftarten fuer den Clip-Titel. Muessen im
// Projektordner liegen (nicht z.B. C:\Windows\Fonts\...) -- siehe Hinweis in
// renderer.js zum Laufwerksbuchstaben-Escaping-Problem bei ffmpeg drawtext.
const path = require('path');

const FONTS_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

const TITLE_FONTS = {
  arial: { label: 'Arial Bold (Standard)', file: path.join(FONTS_DIR, 'arialbd.ttf') },
  impact: { label: 'Impact', file: path.join(FONTS_DIR, 'impact.ttf') },
  comic: { label: 'Comic Sans Bold', file: path.join(FONTS_DIR, 'comicbd.ttf') },
  arialblack: { label: 'Arial Black', file: path.join(FONTS_DIR, 'ariblk.ttf') },
  bahnschrift: { label: 'Bahnschrift', file: path.join(FONTS_DIR, 'bahnschrift.ttf') },
  georgia: { label: 'Georgia Bold', file: path.join(FONTS_DIR, 'georgiab.ttf') }
};

const DEFAULT_TITLE_FONT_KEY = 'arial';

function resolveTitleFont(key) {
  return TITLE_FONTS[key] || TITLE_FONTS[DEFAULT_TITLE_FONT_KEY];
}

function listTitleFonts() {
  return Object.entries(TITLE_FONTS).map(([key, { label }]) => ({ key, label }));
}

module.exports = { TITLE_FONTS, DEFAULT_TITLE_FONT_KEY, resolveTitleFont, listTitleFonts };

// Einfache JSON-Datei-Persistenz fuer die Clip-Liste eines Single-User-Tools.
// Keine Datenbank noetig: ein Array in data/project.json, sequentiell
// gelesen/geschrieben (kein nennenswerter Nebenlauf-Bedarf bei lokaler Nutzung
// durch eine einzelne Person in einem Browser-Tab).
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const PROJECT_FILE = path.join(DATA_DIR, 'project.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DEFAULT_SETTINGS = {
  title: '',
  // Schriftart/-groesse des Gesamttitels (Kopfzeile, einheitlich fuer alle
  // Woerter). Einzelne Woerter koennen zusaetzlich per titleWordColors
  // (Wortindex -> Hexfarbe) eingefaerbt werden; nicht gelistete Woerter
  // bleiben weiss.
  titleFont: 'arial',
  titleFontSize: 62,
  titleWordColors: {}
};

function ensureFile(file, defaultContent) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, defaultContent, 'utf-8');
  }
}

// Erst in eine Temp-Datei schreiben, dann umbenennen: Ein Absturz mitten im
// Schreiben hinterlaesst so nie eine halb geschriebene JSON-Datei, die
// loadClips()/loadVideos() sonst stillschweigend als leere Liste lesen (und
// beim naechsten Speichern endgueltig ueberschreiben) wuerden.
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content = JSON.stringify(data, null, 2);
  const tmpFile = `${file}.tmp`;
  try {
    fs.writeFileSync(tmpFile, content, 'utf-8');
    fs.renameSync(tmpFile, file);
  } catch {
    // Windows: rename kann kurzzeitig scheitern, wenn z.B. ein Virenscanner
    // die Zieldatei offen hat -- dann direkt schreiben.
    fs.writeFileSync(file, content, 'utf-8');
    fs.rmSync(tmpFile, { force: true });
  }
}

function loadClips() {
  ensureFile(PROJECT_FILE, '[]');
  const raw = fs.readFileSync(PROJECT_FILE, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveClips(clips) {
  writeJsonAtomic(PROJECT_FILE, clips);
}

// Projektweite Einstellungen (aktuell nur der Gesamttitel des Rankings, der
// auf jedem Clip als Kopfzeile eingeblendet wird) -- getrennt von der
// Clip-Liste, da sie nicht pro Clip, sondern einmal fuers ganze Video gelten.
function loadSettings() {
  ensureFile(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS));
  const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  writeJsonAtomic(SETTINGS_FILE, settings);
}

module.exports = { loadClips, saveClips, loadSettings, saveSettings, writeJsonAtomic, DATA_DIR };

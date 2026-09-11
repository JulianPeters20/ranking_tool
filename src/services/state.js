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
  ensureFile(PROJECT_FILE, '[]');
  fs.writeFileSync(PROJECT_FILE, JSON.stringify(clips, null, 2), 'utf-8');
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
  ensureFile(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS));
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

module.exports = { loadClips, saveClips, loadSettings, saveSettings, DATA_DIR };

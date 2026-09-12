// JSON-Datei-Persistenz, seit dem Mehrprojekt-Umbau pro Projekt. Jeder Kanal
// ist ein eigenes Projekt mit eigenen Clips, Einstellungen, fertigen Videos
// und eigenem YouTube-Zugang:
//
//   data/projects.json             Liste der Projekte + aktives Projekt
//   data/projects/<id>/            project.json, settings.json, videos.json,
//                                  youtube_token.json, clips/, output/
//   data/youtube_credentials.json  App-Zugangsdaten (fuer alle Projekte gleich)
//   data/emoji-cache/              Emoji-Bilder (projektuebergreifend)
//
// Keine Datenbank noetig: lokale Nutzung durch eine einzelne Person, alle
// Lese-/Schreibvorgaenge laufen sequentiell.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

const DEFAULT_SETTINGS = {
  title: '',
  // Schriftart/-groesse des Gesamttitels (Kopfzeile, einheitlich fuer alle
  // Woerter). Einzelne Woerter koennen zusaetzlich per titleWordColors
  // (Wortindex -> Hexfarbe) eingefaerbt werden; nicht gelistete Woerter
  // bleiben weiss.
  titleFont: 'arial',
  titleFontSize: 62,
  titleWordColors: {},
  // Optionaler Startscreen vor dem ersten Clip: Titel gross und mittig ueber
  // dem weichgezeichneten ersten Clip, wahlweise mit vorgelesenem Text.
  intro: { enabled: false, duration: 2, voice: null }
};

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

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- Projekte

function projectPath(id) {
  return path.join(PROJECTS_DIR, id);
}

function createProjectFolder(id) {
  fs.mkdirSync(path.join(projectPath(id), 'clips'), { recursive: true });
  fs.mkdirSync(path.join(projectPath(id), 'output'), { recursive: true });
}

// Einmalig beim ersten Start nach dem Umbau: die bisherigen Daten (ein
// einziges Projekt direkt in data/) nach projects/<id>/ verschieben.
function migrateLegacyLayout(id) {
  createProjectFolder(id);
  for (const name of ['project.json', 'settings.json', 'videos.json', 'youtube_token.json', 'clips', 'output']) {
    const from = path.join(DATA_DIR, name);
    const to = path.join(projectPath(id), name);
    if (!fs.existsSync(from)) continue;
    fs.rmSync(to, { recursive: true, force: true });
    try {
      fs.renameSync(from, to);
    } catch {
      fs.cpSync(from, to, { recursive: true });
      fs.rmSync(from, { recursive: true, force: true });
    }
  }
  console.log(`Bestehende Daten wurden ins Projekt ${id} verschoben.`);
}

function createRegistry() {
  const id = crypto.randomUUID();
  const hasLegacyData = fs.existsSync(path.join(DATA_DIR, 'project.json'));
  if (hasLegacyData) migrateLegacyLayout(id);
  else createProjectFolder(id);

  return {
    activeProjectId: id,
    projects: [{
      id,
      name: hasLegacyData ? 'Ranking Clips' : 'Erstes Projekt',
      createdAt: new Date().toISOString()
    }]
  };
}

function loadRegistry() {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  let registry = readJson(PROJECTS_FILE, null);

  if (!registry || !Array.isArray(registry.projects) || registry.projects.length === 0) {
    registry = createRegistry();
    writeJsonAtomic(PROJECTS_FILE, registry);
    return registry;
  }
  // Das aktive Projekt kann geloescht worden sein -> auf das erste zurueckfallen.
  if (!registry.projects.some((project) => project.id === registry.activeProjectId)) {
    registry.activeProjectId = registry.projects[0].id;
    writeJsonAtomic(PROJECTS_FILE, registry);
  }
  return registry;
}

function listProjects() {
  const registry = loadRegistry();
  return { activeProjectId: registry.activeProjectId, projects: registry.projects };
}

function getActiveProjectId() {
  return loadRegistry().activeProjectId;
}

function getProjectDir(projectId) {
  return projectPath(projectId || getActiveProjectId());
}

function projectExists(id) {
  return loadRegistry().projects.some((project) => project.id === id);
}

function setActiveProject(id) {
  const registry = loadRegistry();
  if (!registry.projects.some((project) => project.id === id)) return null;
  registry.activeProjectId = id;
  writeJsonAtomic(PROJECTS_FILE, registry);
  return registry;
}

function createProject(name) {
  const registry = loadRegistry();
  const project = { id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString() };
  createProjectFolder(project.id);
  writeJsonAtomic(path.join(projectPath(project.id), 'settings.json'), DEFAULT_SETTINGS);
  writeJsonAtomic(path.join(projectPath(project.id), 'project.json'), []);
  registry.projects.push(project);
  // Neu angelegte Projekte werden direkt aktiv -- man legt sie an, um damit
  // zu arbeiten.
  registry.activeProjectId = project.id;
  writeJsonAtomic(PROJECTS_FILE, registry);
  return project;
}

function renameProject(id, name) {
  const registry = loadRegistry();
  const project = registry.projects.find((entry) => entry.id === id);
  if (!project) return null;
  project.name = name.trim();
  writeJsonAtomic(PROJECTS_FILE, registry);
  return project;
}

// Loescht das Projekt samt aller Dateien (Clips, gerenderte Videos, Token).
// Das letzte verbleibende Projekt kann nicht geloescht werden.
function deleteProject(id) {
  const registry = loadRegistry();
  if (registry.projects.length <= 1) return { error: 'Das letzte Projekt kann nicht gelöscht werden.' };
  const project = registry.projects.find((entry) => entry.id === id);
  if (!project) return { error: 'Projekt nicht gefunden.' };

  registry.projects = registry.projects.filter((entry) => entry.id !== id);
  if (registry.activeProjectId === id) registry.activeProjectId = registry.projects[0].id;
  writeJsonAtomic(PROJECTS_FILE, registry);
  fs.rmSync(projectPath(id), { recursive: true, force: true });
  return { ok: true, activeProjectId: registry.activeProjectId };
}

// ------------------------------------------------- Dateien eines Projekts

function loadClips(projectId) {
  return readJson(path.join(getProjectDir(projectId), 'project.json'), []);
}

function saveClips(clips, projectId) {
  writeJsonAtomic(path.join(getProjectDir(projectId), 'project.json'), clips);
}

// Projektweite Einstellungen (Gesamttitel, Schrift, Wortfarben) -- getrennt
// von der Clip-Liste, da sie nicht pro Clip, sondern einmal fuers ganze Video
// gelten.
function loadSettings(projectId) {
  return { ...DEFAULT_SETTINGS, ...readJson(path.join(getProjectDir(projectId), 'settings.json'), {}) };
}

function saveSettings(settings, projectId) {
  writeJsonAtomic(path.join(getProjectDir(projectId), 'settings.json'), settings);
}

module.exports = {
  DATA_DIR,
  writeJsonAtomic,
  readJson,
  listProjects,
  getActiveProjectId,
  getProjectDir,
  projectExists,
  setActiveProject,
  createProject,
  renameProject,
  deleteProject,
  loadClips,
  saveClips,
  loadSettings,
  saveSettings
};

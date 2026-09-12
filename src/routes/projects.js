const express = require('express');
const {
  listProjects,
  setActiveProject,
  createProject,
  renameProject,
  deleteProject,
  loadClips,
  loadSettings
} = require('../services/state');
const { loadVideos } = require('../services/videoLibrary');
const { getRenderStatus } = require('../services/renderer');

const router = express.Router();

// Jedes Projekt = ein Kanal: eigene Clips, Einstellungen, fertige Videos und
// ein eigener YouTube-Zugang. Die Uebersicht liefert gleich die Eckdaten mit,
// damit die Auswahlliste im Frontend etwas aussagt.
router.get('/projects', (req, res) => {
  const { projects, activeProjectId } = listProjects();
  res.json({
    activeProjectId,
    projects: projects.map((project) => ({
      ...project,
      clipCount: loadClips(project.id).length,
      videoCount: loadVideos(project.id).length,
      title: loadSettings(project.id).title
    }))
  });
});

router.post('/projects', (req, res) => {
  const name = typeof (req.body || {}).name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Bitte einen Projektnamen angeben.' });
  res.status(201).json(createProject(name));
});

router.put('/projects/active', (req, res) => {
  const { id } = req.body || {};
  // Beim Wechseln waehrend eines Renders wuerden Zwischendateien und Ausgabe
  // im falschen Projektordner landen.
  if (getRenderStatus().status === 'running') {
    return res.status(409).json({ error: 'Während des Renderns kann das Projekt nicht gewechselt werden.' });
  }
  const registry = setActiveProject(id);
  if (!registry) return res.status(404).json({ error: 'Projekt nicht gefunden.' });
  res.json({ activeProjectId: registry.activeProjectId });
});

router.put('/projects/:id', (req, res) => {
  const name = typeof (req.body || {}).name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Bitte einen Projektnamen angeben.' });
  const project = renameProject(req.params.id, name);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden.' });
  res.json(project);
});

router.delete('/projects/:id', (req, res) => {
  if (getRenderStatus().status === 'running') {
    return res.status(409).json({ error: 'Während des Renderns kann kein Projekt gelöscht werden.' });
  }
  const result = deleteProject(req.params.id);
  if (result.error) return res.status(result.error.includes('nicht gefunden') ? 404 : 409).json(result);
  res.json(result);
});

module.exports = router;

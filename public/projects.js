// Projektauswahl im Kopfbereich beider Seiten. Ein Projekt = ein Kanal mit
// eigenen Clips, Einstellungen, fertigen Videos und eigenem YouTube-Zugang.
// Nach einem Wechsel wird die Seite neu geladen: So passen Clipliste,
// Einstellungen, Planer und Verbindungsstatus garantiert zum gewählten
// Projekt, ohne dass jede Seite einzeln nachziehen muss.
(() => {
  const selectEl = document.getElementById('project-select');
  if (!selectEl) return;
  const newBtn = document.getElementById('project-new-btn');
  const renameBtn = document.getElementById('project-rename-btn');
  const deleteBtn = document.getElementById('project-delete-btn');

  let projects = [];
  let activeProjectId = null;

  async function api(url, options) {
    const res = await fetch(url, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request fehlgeschlagen (${res.status})`);
    return body;
  }

  function send(url, method, payload) {
    return api(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  function activeProject() {
    return projects.find((project) => project.id === activeProjectId);
  }

  async function load() {
    const data = await api('/api/projects');
    projects = data.projects;
    activeProjectId = data.activeProjectId;

    selectEl.innerHTML = '';
    for (const project of projects) {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = `${project.name} — ${project.clipCount} Clips, ${project.videoCount} Videos`;
      selectEl.appendChild(option);
    }
    selectEl.value = activeProjectId;
    deleteBtn.disabled = projects.length <= 1;
  }

  selectEl.addEventListener('change', async () => {
    try {
      await send('/api/projects/active', 'PUT', { id: selectEl.value });
      location.reload();
    } catch (err) {
      alert(`Projekt konnte nicht gewechselt werden: ${err.message}`);
      selectEl.value = activeProjectId;
    }
  });

  newBtn.addEventListener('click', async () => {
    const name = prompt('Name des neuen Projekts (z.B. "GTA 6 Clips"):');
    if (!name || !name.trim()) return;
    try {
      await send('/api/projects', 'POST', { name });
      location.reload(); // neues Projekt ist sofort aktiv
    } catch (err) {
      alert(`Projekt konnte nicht angelegt werden: ${err.message}`);
    }
  });

  renameBtn.addEventListener('click', async () => {
    const current = activeProject();
    if (!current) return;
    const name = prompt('Neuer Name:', current.name);
    if (!name || !name.trim() || name === current.name) return;
    try {
      await send(`/api/projects/${current.id}`, 'PUT', { name });
      await load();
    } catch (err) {
      alert(`Projekt konnte nicht umbenannt werden: ${err.message}`);
    }
  });

  deleteBtn.addEventListener('click', async () => {
    const current = activeProject();
    if (!current) return;
    const question = `Projekt "${current.name}" wirklich löschen?\n\n`
      + `Dabei werden ${current.clipCount} Clips und ${current.videoCount} fertige Videos `
      + 'samt Dateien und der YouTube-Verbindung dieses Projekts endgültig entfernt.';
    if (!confirm(question)) return;
    try {
      await api(`/api/projects/${current.id}`, { method: 'DELETE' });
      location.reload();
    } catch (err) {
      alert(`Projekt konnte nicht gelöscht werden: ${err.message}`);
    }
  });

  load().catch((err) => {
    console.error('Projekte konnten nicht geladen werden:', err);
  });
})();

// Anbindung an h3-studio (D:\Projects\h3-studio): erzeugt aus einem Prompt und
// einem hinterlegten Charakter einen Videoclip mit Ton und legt ihn ins Projekt,
// damit der freie Schnitt ihn wie einen hochgeladenen Clip verwenden kann.
//
// h3-studio spricht mit dem lokal laufenden MiniMax H3 ueber ComfyUI. Die
// Charaktere werden dort unter einem Namen gefuehrt -- dieses Tool schickt
// also "bibo" und keinen Dateipfad.
//
// Ablauf laut h3-studio-API:
//   GET  /api/health                    laeuft alles (ComfyUI + Modelle)?
//   GET  /api/characters                hinterlegte Charaktere
//   POST /api/jobs                      { prompt, characters, ... } -> { id }
//   GET  /api/jobs/{id}                 status/progress
//   GET  /api/jobs/{id}/outputs/0       fertige Videodatei
//
// h3-studio UND ComfyUI muessen laufen. Sind sie es nicht, meldet das Tool das
// freundlich statt zu scheitern.
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.H3_STUDIO_URL || 'http://127.0.0.1:3100';
const REQUEST_TIMEOUT_MS = 5000;
// Gemessen auf einer RTX 4070 Ti: rund 2,5 Sekunden Rechenzeit pro Frame,
// also gut 10 Minuten fuer einen 10-Sekunden-Clip. Dazu beim ersten Job noch
// die Modell-Initialisierung. Entsprechend grosszuegig.
const GENERATION_TIMEOUT_MS = 45 * 60 * 1000;
const START_HINT = 'h3-studio ist unter %s nicht erreichbar. Starten: ComfyUI (start-comfyui.cmd) und dann "npm start" in D:\\Projects\\h3-studio.';

async function request(pathname, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${pathname}`, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    // "fetch failed"/AbortError sagen dem Nutzer nichts -- der haeufigste Fall
    // ist schlicht: h3-studio laeuft gerade nicht.
    throw new Error(START_HINT.replace('%s', BASE_URL));
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let message = detail.slice(0, 300);
    try {
      const parsed = JSON.parse(detail);
      message = parsed.error || message;
      // h3-studio reicht ComfyUIs Node-Fehler lesbar durch -- die sind
      // aussagekraeftiger als der blosse Statuscode.
      if (Array.isArray(parsed.details && parsed.details.nodeErrors)) {
        message += ` (${parsed.details.nodeErrors.join('; ')})`;
      }
    } catch {
      /* kein JSON -- dann bleibt der Rohtext */
    }
    throw new Error(`h3-studio antwortete mit ${res.status}${message ? `: ${message}` : ''}`);
  }
  return res;
}

// Status fuer die Oberflaeche: laeuft h3-studio, ist alles bereit, und welche
// Charaktere gibt es? Kurz zwischengespeichert -- die Schnittseite pollt alle
// 1,5 s den kompletten Schnitt-Status, ohne Cache liefe jede Abfrage bei nicht
// laufendem h3-studio in eine Zeitueberschreitung. Gleiche Ueberlegung wie
// bei der Voicebox.
const STATUS_CACHE_MS = 15000;
let statusCache = { at: 0, value: null };

async function getStatus() {
  if (statusCache.value && Date.now() - statusCache.at < STATUS_CACHE_MS) {
    return statusCache.value;
  }
  const value = await readStatus();
  statusCache = { at: Date.now(), value };
  return value;
}

// Nach einer Aenderung an den Charakteren nicht bis zu 15 s auf veraltete
// Daten warten lassen.
function invalidateStatus() {
  statusCache = { at: 0, value: null };
}

async function readStatus() {
  let health;
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    health = await res.json();
  } catch {
    return { available: false, ready: false, characters: [], hint: START_HINT.replace('%s', BASE_URL) };
  }

  // h3-studio laeuft -- aber ist auch ComfyUI da und sind die Modelle komplett?
  // Das ist ein anderer Fehlerfall und braucht einen anderen Hinweis.
  if (!health.ok) {
    const missing = Object.entries(health.models || {})
      .filter(([, s]) => !s.present || s.plausible === false)
      .map(([file]) => file);
    let hint;
    if (!health.comfy || !health.comfy.reachable) {
      hint = 'ComfyUI laeuft nicht. Starten: D:\\Projects\\h3-studio\\start-comfyui.cmd';
    } else if (missing.length) {
      hint = `Modelldateien fehlen oder sind unvollstaendig: ${missing.join(', ')}`;
    } else {
      hint = 'h3-studio meldet sich als nicht bereit.';
    }
    return { available: true, ready: false, characters: [], hint };
  }

  try {
    const res = await request('/api/characters');
    const characters = await res.json();
    return {
      available: true,
      ready: true,
      characters: (Array.isArray(characters) ? characters : []).map((c) => ({
        id: c.id,
        name: c.name || c.id,
        imageCount: c.imageCount
      }))
    };
  } catch (err) {
    return { available: true, ready: true, characters: [], hint: String(err.message || err) };
  }
}

/**
 * Erzeugt einen Clip und legt ihn unter targetPath ab.
 *
 * onProgress bekommt den Job-Zustand und wird genutzt, um den Fortschritt in
 * den Schnitt-Eintrag zu schreiben -- die Oberflaeche pollt ohnehin GET /api/cut,
 * also reicht das und es braucht keinen zweiten Kanal zum Browser.
 */
async function generateClip({ prompt, characters, durationSeconds, aspect }, targetPath, onProgress) {
  const startRes = await request('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, characters, durationSeconds, aspect })
  }, 30000);
  const job = await startRes.json();
  if (!job || !job.id) throw new Error('h3-studio hat keine Job-ID zurückgegeben.');

  const finished = await waitForCompletion(job.id, onProgress);

  if (!finished.outputs || finished.outputs.length === 0) {
    throw new Error('h3-studio meldet den Job als fertig, liefert aber keine Datei.');
  }

  // Ueber HTTP holen statt den absoluten Pfad aus der Antwort zu lesen: so
  // bleibt die Anbindung unabhaengig davon, wo h3-studio laeuft.
  const fileRes = await request(`/api/jobs/${job.id}/outputs/0`, {}, 5 * 60 * 1000);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, buffer);

  return { jobId: job.id, bytes: buffer.length, plan: finished.plan };
}

// h3-studio bietet Server-Sent Events an -- damit sehen wir jeden
// Sampling-Schritt, ohne im Sekundentakt zu pollen. Der Strom bleibt offen,
// solange der Job laeuft (Minuten).
async function waitForCompletion(jobId, onProgress) {
  const res = await request(`/api/jobs/${jobId}/stream`, {}, GENERATION_TIMEOUT_MS);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let last = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        let payload;
        try {
          payload = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        last = payload;
        if (typeof onProgress === 'function') onProgress(payload);

        if (payload.status === 'error') {
          throw new Error(payload.error || 'h3-studio konnte den Clip nicht erzeugen.');
        }
        if (payload.status === 'cancelled' || payload.status === 'interrupted') {
          throw new Error('Die Erzeugung wurde abgebrochen.');
        }
        if (payload.status === 'done') {
          return payload;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  // Der Strom endete, ohne "done" zu melden -- einmal direkt nachfragen,
  // bevor wir aufgeben. Das faengt einen Verbindungsabbruch kurz vor Schluss ab.
  const check = await request(`/api/jobs/${jobId}`).then((r) => r.json()).catch(() => null);
  if (check && check.status === 'done') return check;
  throw new Error(
    `h3-studio hat die Erzeugung nicht abgeschlossen (zuletzt: ${(check || last || {}).status || 'unbekannt'}).`
  );
}

async function cancel(jobId) {
  await request(`/api/jobs/${jobId}/cancel`, { method: 'POST' }, 10000);
}

module.exports = { getStatus, invalidateStatus, generateClip, cancel, BASE_URL };

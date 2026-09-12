// Anbindung an die lokal laufende Voicebox (https://github.com/jamiepine/voicebox):
// Text wird mit einem dort angelegten Stimmprofil vorgelesen und als
// Audiodatei ins Projekt gelegt, damit der freie Schnitt sie unter das Video
// mischen kann.
//
// Ablauf laut Voicebox-API:
//   GET  /health                     laeuft der Server?
//   GET  /profiles                   vorhandene Stimmprofile
//   POST /generate                   { profile_id, text, language } -> { id }
//   GET  /generate/{id}/status       "generating" | "completed" | "failed"
//   GET  /audio/{id}                 fertige Audiodatei
//
// Voicebox muss dafuer laufen (server.ps1 start voicebox). Ist sie nicht
// erreichbar, meldet das Tool das freundlich statt zu scheitern.
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.VOICEBOX_URL || 'http://127.0.0.1:17493';
const REQUEST_TIMEOUT_MS = 5000;
// Die erste Erzeugung laedt das Modell herunter (mehrere GB) -- daher grosszuegig.
const GENERATION_TIMEOUT_MS = 15 * 60 * 1000;

async function request(pathname, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${pathname}`, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    // "fetch failed"/AbortError sagen dem Nutzer nichts -- der haeufigste Fall
    // ist schlicht: Voicebox laeuft gerade nicht.
    throw new Error(`Voicebox ist unter ${BASE_URL} nicht erreichbar. Starten mit: server.ps1 start voicebox`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Voicebox antwortete mit ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  return res;
}

// Status fuer die Oberflaeche: laeuft Voicebox, und welche Stimmen gibt es?
// Kurz zwischengespeichert, weil die Schnittseite beim Poll (alle 1,5 s) den
// kompletten Schnitt-Status laedt -- ohne Cache liefe jede Abfrage bei nicht
// laufender Voicebox in eine Zeitueberschreitung.
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

async function readStatus() {
  try {
    await request('/health', {}, 2000);
  } catch (err) {
    return {
      available: false,
      profiles: [],
      hint: `Voicebox ist unter ${BASE_URL} nicht erreichbar. Starten mit: server.ps1 start voicebox`
    };
  }
  try {
    const res = await request('/profiles');
    const profiles = await res.json();
    return {
      available: true,
      profiles: (Array.isArray(profiles) ? profiles : []).map((profile) => ({
        id: profile.id,
        name: profile.name || profile.display_name || profile.id
      }))
    };
  } catch (err) {
    return { available: true, profiles: [], hint: String(err.message || err) };
  }
}

// /generate/{id}/status ist ein Ereignis-Strom (SSE, Zeilen der Form
// "data: {...}") und kein einzelnes JSON -- wir lesen ihn mit, bis Voicebox
// "completed" oder "failed" meldet. Der Strom bleibt so lange offen, wie die
// Erzeugung dauert (beim ersten Mal inkl. Modell-Download).
async function waitForCompletion(generationId) {
  const res = await request(`/generate/${generationId}/status`, {}, GENERATION_TIMEOUT_MS);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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
      if (payload.status === 'failed') {
        await reader.cancel();
        throw new Error(payload.error || 'Voicebox konnte die Stimme nicht erzeugen.');
      }
      if (payload.status === 'not_found') {
        await reader.cancel();
        throw new Error('Voicebox kennt diesen Vorgang nicht mehr.');
      }
      if (payload.status === 'completed') {
        await reader.cancel();
        return payload;
      }
    }
  }
  throw new Error('Voicebox hat die Erzeugung nicht abgeschlossen.');
}

// Erzeugt die Sprachaufnahme und legt sie unter targetPath ab.
async function generateSpeech({ text, profileId, language = 'en' }, targetPath) {
  const startRes = await request('/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_id: profileId, text, language })
  }, 60000);
  const generation = await startRes.json();
  if (!generation || !generation.id) throw new Error('Voicebox hat keine Vorgangs-ID zurückgegeben.');

  if (generation.status !== 'completed') {
    await waitForCompletion(generation.id);
  }

  const audioRes = await request(`/audio/${generation.id}`, {}, 120000);
  const buffer = Buffer.from(await audioRes.arrayBuffer());
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, buffer);
  return { generationId: generation.id, bytes: buffer.length };
}

module.exports = { getStatus, generateSpeech, BASE_URL };

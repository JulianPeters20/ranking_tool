// Prueft, dass die Voicebox-Anbindung die richtige Engine je Profil waehlt.
//
// Hintergrund: Voicebox setzt fuer /generate den Default engine="qwen", wenn
// das Feld fehlt. Preset-Profile akzeptieren aber ausschliesslich ihre eigene
// preset_engine -- ein Kokoro-Profil scheitert dann mit HTTP 400.
//
// Voraussetzung: Voicebox laeuft (server.ps1 start voicebox).
// Aufruf: node scripts/test-voicebox-engine.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const voicebox = require('../src/services/voicebox');

let failed = 0;

function ok(label) {
  console.log(`  OK     ${label}`);
}
function bad(label, detail) {
  failed++;
  console.log(`  FEHLER ${label}${detail ? `\n         ${detail}` : ''}`);
}

async function main() {
  const status = await voicebox.getStatus();
  if (!status.available) {
    console.error(`\nABBRUCH: ${status.hint || 'Voicebox nicht erreichbar'}`);
    process.exit(1);
  }

  console.log('\n== Profile ==');
  for (const p of status.profiles) {
    console.log(`  ${p.name}: voiceType=${p.voiceType} presetEngine=${p.presetEngine || '-'} defaultEngine=${p.defaultEngine || '-'}`);
  }

  console.log('\n== Engine-Auflösung ==');
  // Reine Logikpruefung, ohne Netz: welche Engine wuerde geschickt?
  const cases = [
    [{ voiceType: 'preset', presetEngine: 'kokoro', defaultEngine: 'kokoro' }, 'kokoro', 'Preset-Profil -> preset_engine'],
    [{ voiceType: 'preset', presetEngine: 'tada', defaultEngine: null }, 'tada', 'Preset ohne default_engine'],
    [{ voiceType: 'cloned', presetEngine: null, defaultEngine: 'chatterbox' }, 'chatterbox', 'Cloned mit default_engine'],
    [{ voiceType: 'cloned', presetEngine: null, defaultEngine: null }, undefined, 'Cloned ohne Angabe -> Voicebox-Default'],
    [{ voiceType: 'designed', presetEngine: null, defaultEngine: null }, undefined, 'Designed ohne Angabe']
  ];
  for (const [profile, expected, label] of cases) {
    const got = voicebox.resolveEngine(profile);
    if (got === expected) ok(`${label} => ${got === undefined ? '(keins)' : got}`);
    else bad(label, `erwartet ${expected === undefined ? '(keins)' : expected}, bekam ${got === undefined ? '(keins)' : got}`);
  }

  // Ein Preset-Profil mit abweichender Engine muss klar scheitern, nicht still
  // die falsche Engine schicken.
  try {
    voicebox.resolveEngine({ voiceType: 'preset', presetEngine: null, defaultEngine: null });
    bad('Preset ohne preset_engine muss Fehler werfen');
  } catch (err) {
    ok(`Preset ohne preset_engine wirft: ${err.message.slice(0, 60)}`);
  }

  console.log('\n== Echte Erzeugung je Profil ==');
  const tmp = path.join(os.tmpdir(), 'voicebox-engine-test');
  fs.mkdirSync(tmp, { recursive: true });

  for (const p of status.profiles) {
    const target = path.join(tmp, `${p.id}.wav`);
    try {
      const res = await voicebox.generateSpeech(
        { text: 'This is a short engine test.', profileId: p.id, language: 'en' },
        target
      );
      const bytes = fs.existsSync(target) ? fs.statSync(target).size : 0;
      if (bytes > 1000) ok(`${p.name} (${p.presetEngine || p.defaultEngine || 'Default'}) -> ${Math.round(bytes / 1024)} KB`);
      else bad(`${p.name}: Datei zu klein (${bytes} Bytes)`);
    } catch (err) {
      bad(`${p.name}`, String(err.message || err).slice(0, 200));
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${failed === 0 ? 'ALLE PRUEFUNGEN BESTANDEN' : `${failed} FEHLGESCHLAGEN`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nABBRUCH: ${err.message}`);
  process.exit(1);
});

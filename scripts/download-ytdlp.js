// Einmaliger Setup-Schritt: laedt die aktuelle yt-dlp-Binary direkt von
// GitHub herunter und legt sie unter ./bin ab. Aufruf: npm run setup
// Aktualisieren (TikTok aendert regelmaessig seine Seite, alte yt-dlp-
// Versionen koennen dann nichts mehr laden): npm run update-ytdlp
// (Kein npm-Paket dafuer noetig -- yt-dlp-wrap ist deprecated, daher rufen
// wir die Binary wie ffmpeg direkt per child_process auf.)
const fs = require('fs');
const path = require('path');
const https = require('https');

const binDir = path.join(__dirname, '..', 'bin');
const assetName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const binaryPath = path.join(binDir, assetName);
const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;
const force = process.argv.includes('--force');

function download(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ranking-clips-tool-setup' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectsLeft <= 0) return reject(new Error('Zu viele Redirects beim Download.'));
        res.resume();
        return resolve(download(res.headers.location, destPath, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download fehlgeschlagen: HTTP ${res.statusCode}`));
      }
      // Bei einem Verbindungsabbruch wuerde der Stream sonst "normal" enden
      // und eine abgeschnittene, kaputte Binary hinterlassen.
      const expectedBytes = Number(res.headers['content-length']) || null;
      let receivedBytes = 0;
      res.on('data', (chunk) => { receivedBytes += chunk.length; });
      res.on('error', reject);

      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close((err) => {
        if (err) return reject(err);
        if (expectedBytes !== null && receivedBytes !== expectedBytes) {
          return reject(new Error(`Download unvollständig (${receivedBytes} von ${expectedBytes} Bytes).`));
        }
        resolve();
      }));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (fs.existsSync(binaryPath) && !force) {
    console.log(`yt-dlp ist bereits vorhanden: ${binaryPath}`);
    console.log('Aktualisieren mit: npm run update-ytdlp');
    return;
  }

  fs.mkdirSync(binDir, { recursive: true });
  // Erst in eine .part-Datei laden: Ein abgebrochener Download hinterlaesst so
  // keine kaputte Binary, die der naechste Setup-Lauf als "vorhanden" ansieht.
  const partPath = `${binaryPath}.part`;
  console.log(`Lade yt-dlp von ${downloadUrl} herunter ...`);
  try {
    await download(downloadUrl, partPath);
  } catch (err) {
    fs.rmSync(partPath, { force: true });
    throw err;
  }
  if (process.platform !== 'win32') {
    fs.chmodSync(partPath, 0o755);
  }
  fs.renameSync(partPath, binaryPath);
  console.log(`Fertig: ${binaryPath}`);
}

main().catch((err) => {
  console.error('Download von yt-dlp fehlgeschlagen:', err);
  if (err && (err.code === 'EPERM' || err.code === 'EBUSY')) {
    console.error('Hinweis: yt-dlp wird gerade benutzt -- Server (npm start) beenden und erneut versuchen.');
  }
  process.exit(1);
});

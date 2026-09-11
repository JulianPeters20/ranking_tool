// Einmaliger Setup-Schritt: laedt die aktuelle yt-dlp-Binary direkt von
// GitHub herunter und legt sie unter ./bin ab. Aufruf: npm run setup
// (Kein npm-Paket dafuer noetig -- yt-dlp-wrap ist deprecated, daher rufen
// wir die Binary wie ffmpeg direkt per child_process auf.)
const fs = require('fs');
const path = require('path');
const https = require('https');

const binDir = path.join(__dirname, '..', 'bin');
const assetName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const binaryPath = path.join(binDir, assetName);
const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;

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
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (fs.existsSync(binaryPath)) {
    console.log(`yt-dlp ist bereits vorhanden: ${binaryPath}`);
    return;
  }

  fs.mkdirSync(binDir, { recursive: true });
  console.log(`Lade yt-dlp von ${downloadUrl} herunter ...`);
  await download(downloadUrl, binaryPath);
  if (process.platform !== 'win32') {
    fs.chmodSync(binaryPath, 0o755);
  }
  console.log(`Fertig: ${binaryPath}`);
}

main().catch((err) => {
  console.error('Download von yt-dlp fehlgeschlagen:', err);
  process.exit(1);
});

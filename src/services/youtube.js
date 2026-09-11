// OAuth-Verbindung zu YouTube (Client-ID/Secret + Tokens lokal gespeichert)
// und Video-Upload ueber die YouTube Data API v3.
//
// Wichtige Hintergrund-Infos (siehe README fuer die vollstaendige Anleitung):
// - Das Google-Cloud-OAuth-Projekt muss auf Publishing-Status "In Production"
//   stehen (Self-Service-Toggle in der Google Cloud Console), sonst laeuft
//   das Refresh-Token beim sensiblen Scope "youtube.upload" nach 7 Tagen ab.
// - Neue/unauditierte API-Projekte setzen alle hochgeladenen Videos
//   zwangsweise auf privat, bis ein einmaliger YouTube-Compliance-Audit
//   durchgefuehrt wurde. status.publishAt wird trotzdem gesetzt -- sobald der
//   Audit durch ist, greift die Planung automatisch.
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { DATA_DIR } = require('./state');

const CREDENTIALS_FILE = path.join(DATA_DIR, 'youtube_credentials.json');
const TOKEN_FILE = path.join(DATA_DIR, 'youtube_token.json');
const PORT = process.env.PORT || 3000;
const REDIRECT_URI = `http://localhost:${PORT}/auth/youtube/callback`;
const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCredentials(clientId, clientSecret) {
  ensureDataDir();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({ clientId, clientSecret }, null, 2), 'utf-8');
}

function loadToken() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveToken(tokens) {
  ensureDataDir();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
}

function disconnect() {
  if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
}

function isConfigured() {
  return !!loadCredentials();
}

function isConnected() {
  return !!loadCredentials() && !!loadToken();
}

// Neuer OAuth2Client pro Aufruf (verhindert Zustands-Leichen), persistiert
// automatisch aufgefrischte Access-Tokens zurueck auf die Festplatte.
function getOAuth2Client() {
  const creds = loadCredentials();
  if (!creds) throw new Error('YouTube-Zugangsdaten (Client-ID/Secret) sind noch nicht hinterlegt.');

  const client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, REDIRECT_URI);
  const token = loadToken();
  if (token) client.setCredentials(token);

  client.on('tokens', (newTokens) => {
    const merged = { ...(loadToken() || {}), ...newTokens };
    saveToken(merged);
  });

  return client;
}

function getAuthUrl() {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [UPLOAD_SCOPE]
  });
}

async function handleOAuthCallback(code) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  saveToken(tokens);
}

async function getChannelInfo() {
  if (!isConnected()) return null;
  const auth = getOAuth2Client();
  const youtube = google.youtube({ version: 'v3', auth });
  const res = await youtube.channels.list({ part: ['snippet'], mine: true });
  const channel = res.data.items && res.data.items[0];
  return channel ? { title: channel.snippet.title } : null;
}

// Laedt die Videodatei hoch, privat + mit publishAt fuer die geplante Uhrzeit.
// YouTube macht das Video dann selbststaendig zur richtigen Zeit oeffentlich
// (siehe Hinweis oben zum Compliance-Audit).
async function uploadVideo(entry) {
  const auth = getOAuth2Client();
  const youtube = google.youtube({ version: 'v3', auth });
  const filePath = path.join(DATA_DIR, entry.filePath);

  const description = entry.youtubeDescription
    ? `${entry.youtubeDescription}\n\n#Shorts`
    : '#Shorts';

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: entry.youtubeTitle || 'Ranking Video',
        description,
        tags: entry.tags && entry.tags.length ? entry.tags : undefined
      },
      status: {
        privacyStatus: 'private',
        publishAt: entry.scheduledAt,
        selfDeclaredMadeForKids: !!entry.madeForKids
      }
    },
    media: {
      body: fs.createReadStream(filePath)
    }
  });

  return res.data.id;
}

module.exports = {
  isConfigured,
  isConnected,
  saveCredentials,
  getAuthUrl,
  handleOAuthCallback,
  getChannelInfo,
  uploadVideo,
  disconnect
};

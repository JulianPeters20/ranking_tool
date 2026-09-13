// OAuth-Verbindung zu YouTube und Video-Upload ueber die YouTube Data API v3.
//
// Seit dem Mehrprojekt-Umbau gilt: Die App-Zugangsdaten (Client-ID/Secret)
// sind fuer alle Projekte gleich und liegen in data/, das Token liegt pro
// Projekt im Projektordner -- jedes Projekt ist damit an genau einen Kanal
// gebunden und es kann nichts auf dem falschen Kanal landen.
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
const crypto = require('crypto');
const { google } = require('googleapis');
const { DATA_DIR, getProjectDir, getActiveProjectId } = require('./state');

const CREDENTIALS_FILE = path.join(DATA_DIR, 'youtube_credentials.json');
const PORT = process.env.PORT || 3000;
const REDIRECT_URI = `http://localhost:${PORT}/auth/youtube/callback`;
const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

function tokenFile(projectId) {
  return path.join(getProjectDir(projectId), 'youtube_token.json');
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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({ clientId, clientSecret }, null, 2), 'utf-8');
}

function loadToken(projectId) {
  const file = tokenFile(projectId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function saveToken(tokens, projectId) {
  const file = tokenFile(projectId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(tokens, null, 2), 'utf-8');
}

function disconnect(projectId) {
  const file = tokenFile(projectId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function isConfigured() {
  return !!loadCredentials();
}

function isConnected(projectId) {
  return !!loadCredentials() && !!loadToken(projectId);
}

// Neuer OAuth2Client pro Aufruf (verhindert Zustands-Leichen), persistiert
// automatisch aufgefrischte Access-Tokens zurueck ins richtige Projekt.
function getOAuth2Client(projectId) {
  const creds = loadCredentials();
  if (!creds) throw new Error('YouTube-Zugangsdaten (Client-ID/Secret) sind noch nicht hinterlegt.');

  const client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, REDIRECT_URI);
  const token = loadToken(projectId);
  if (token) client.setCredentials(token);

  client.on('tokens', (newTokens) => {
    saveToken({ ...(loadToken(projectId) || {}), ...newTokens }, projectId);
  });

  return client;
}

// Zufaelliger state-Wert pro Anmeldeversuch: Der Callback akzeptiert nur
// Codes aus einem hier gestarteten Flow -- sonst koennte eine fremde Seite
// per Link einen Code unterschieben und so einen fremden Kanal verbinden.
// Im state steckt zusaetzlich das Projekt, zu dem der Kanal gehoeren soll.
let pendingOAuth = null;

function getAuthUrl(projectId) {
  const id = projectId || getActiveProjectId();
  const client = getOAuth2Client(id);
  pendingOAuth = { state: crypto.randomBytes(16).toString('hex'), projectId: id };
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [UPLOAD_SCOPE],
    state: pendingOAuth.state
  });
}

async function handleOAuthCallback(code, state) {
  if (!pendingOAuth || state !== pendingOAuth.state) {
    throw new Error('Ungültige oder abgelaufene Anmeldeanfrage – bitte "Mit YouTube verbinden" erneut klicken.');
  }
  const { projectId } = pendingOAuth;
  pendingOAuth = null;
  if (!code) throw new Error('Kein Autorisierungscode von Google erhalten.');

  const client = getOAuth2Client(projectId);
  const { tokens } = await client.getToken(code);
  saveToken(tokens, projectId);
  return { projectId };
}

async function getChannelInfo(projectId) {
  if (!isConnected(projectId)) return null;
  const auth = getOAuth2Client(projectId);
  const youtube = google.youtube({ version: 'v3', auth });
  try {
    const res = await youtube.channels.list({ part: ['snippet'], mine: true });
    const channel = res.data.items && res.data.items[0];
    return channel ? { title: channel.snippet.title } : null;
  } catch (err) {
    // Der (bewusst einzige) Scope youtube.upload erlaubt keinen Lesezugriff
    // auf Kanaldaten -> Google antwortet "insufficient authentication
    // scopes". Das beweist aber, dass das Token gueltig ist: kein Fehler,
    // nur kein Kanalname verfuegbar.
    if (/insufficient/i.test(String(err.message))) return null;
    throw err;
  }
}

// Laedt die Videodatei hoch, privat + mit publishAt fuer die geplante Uhrzeit.
// YouTube macht das Video dann selbststaendig zur richtigen Zeit oeffentlich
// (siehe Hinweis oben zum Compliance-Audit).
async function uploadVideo(entry, projectId) {
  const auth = getOAuth2Client(projectId);
  const youtube = google.youtube({ version: 'v3', auth });
  const filePath = path.join(getProjectDir(projectId), entry.filePath);

  // "#Shorts" gehoert nur unter Hochkant-Videos. Der freie Schnitt kann auch
  // quer (16:9) oder quadratisch rendern -- dort wuerde der Hashtag YouTube
  // ein Shorts-Video versprechen, das keines ist. Fehlt die Groesse (aeltere
  // Eintraege vor diesem Feld), bleibt es beim bisherigen Verhalten: die
  // stammen alle aus dem Ranking-Render und sind immer 1080x1920.
  const isPortrait = !(Number(entry.width) > 0 && Number(entry.height) > 0)
    || Number(entry.height) > Number(entry.width);
  const parts = [entry.youtubeDescription, isPortrait ? '#Shorts' : null].filter(Boolean);
  const description = parts.join('\n\n');

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
        selfDeclaredMadeForKids: !!entry.madeForKids,
        // Selbstauskunft "realistisches verändertes oder synthetisches
        // Material" (YouTube Data API v3, bei videos.insert schreibbar).
        // Betrifft hier vor allem Startscreens mit KI-Stimme.
        containsSyntheticMedia: !!entry.containsSyntheticMedia
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

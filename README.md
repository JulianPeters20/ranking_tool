# Ranking Clips Tool

Lokales, kostenloses Tool: TikTok-Links einfügen, Clips werden automatisch
heruntergeladen, pro Clip Ausschnitt/Reihenfolge/Titel festlegen (inkl.
Videovorschau zur Auswahl) — daraus wird ein fertiges Ranking-Video gerendert:
ein wortweise einfärbbarer Gesamttitel oben und eine permanente Rangliste
links (aufsteigend sortiert), in der die Clip-Titel erscheinen, sobald der
jeweilige Clip dran war/ist. Das ist die einzige Stelle, an der ein Clip-Titel
zu sehen ist — es gibt keine zusätzliche Einblendung im Video selbst.

Läuft komplett lokal, keine Cloud, kein Account, kein Abo.

## Voraussetzungen

- Node.js (getestet mit v26)
- ffmpeg im PATH verfügbar (`ffmpeg -version` sollte funktionieren)

## Setup

```bash
npm install
npm run setup   # lädt einmalig die yt-dlp-Binary herunter (bin/yt-dlp.exe)
npm start
```

Dann im Browser öffnen: http://localhost:3000

### Mehrere Projekte (ein Projekt = ein Kanal)

Oben auf beiden Seiten steht eine **Projektauswahl**. Jedes Projekt hat eigene
Clips, eigene Titel-Einstellungen, eine eigene Videobibliothek **und einen
eigenen YouTube-Kanal** — so kann nichts versehentlich auf dem falschen Kanal
landen. Gemeinsam bleiben nur die App-Zugangsdaten (Client-ID/Secret) und der
Emoji-Zwischenspeicher.

```
data/projects.json            Liste der Projekte + aktives Projekt
data/projects/<id>/           project.json, settings.json, videos.json,
                              youtube_token.json, clips/, output/
data/youtube_credentials.json App-Zugangsdaten (für alle Projekte)
data/emoji-cache/             Emoji-Bilder (für alle Projekte)
```

- **Neu** legt ein Projekt an und aktiviert es sofort.
- **Umbenennen** / **Löschen** beziehen sich auf das aktive Projekt; das letzte
  Projekt lässt sich nicht löschen. Löschen entfernt Clips, fertige Videos und
  die YouTube-Verbindung dieses Projekts endgültig.
- Für einen neuen Kanal: Projekt anlegen, in den **YouTube Planer** wechseln und
  dort einmal **"Mit YouTube verbinden"** klicken — dabei im Google-Dialog den
  zum Projekt gehörenden Kanal auswählen.
- Geplante Uploads laufen projektübergreifend weiter: Der Retry beim Start und
  alle 5 Minuten prüft alle Projekte, egal welches gerade geöffnet ist.
- Während eines Renders sind Projektwechsel und Löschen gesperrt.

Beim ersten Start nach dem Umbau werden vorhandene Daten automatisch in ein
Projekt namens "Ranking Clips" verschoben.

### Starten und Stoppen per Skript

Statt `npm start` in einem offenen Terminal lassen sich das Ranking-Tool und
(falls eingerichtet) Voicebox im Hintergrund steuern — per Doppelklick auf
**`Server starten.cmd`** / **`Server stoppen.cmd`** oder im Terminal:

```powershell
.\server.ps1 start             # alles starten (Ranking-Tool + Voicebox), Browser öffnen
.\server.ps1 start ranking     # nur das Ranking-Tool
.\server.ps1 stop voicebox     # nur Voicebox beenden
.\server.ps1 status            # was läuft gerade?
.\server.ps1 restart -NoBrowser
```

Die Server laufen unsichtbar weiter, auch wenn das Fenster geschlossen wird;
ihre Ausgaben stehen in `.run\<dienst>.log`. Voicebox wird unter
`D:\Projects\voicebox` erwartet (Pfad oben in `server.ps1` anpassbar). Beim
Stoppen werden nur Prozesse beendet, die zum jeweiligen Dienst passen — ein
fremdes Programm auf demselben Port bleibt unangetastet.

Der Server ist standardmäßig nur vom eigenen Rechner aus erreichbar
(`127.0.0.1`), da die API keine Anmeldung hat. Für Zugriff aus dem lokalen
Netzwerk bewusst `HOST=0.0.0.0` setzen.

Schlagen TikTok-Downloads plötzlich fehl, ist meist yt-dlp veraltet (TikTok
ändert regelmäßig seine Seite): Server beenden, dann `npm run update-ytdlp`.

## Nutzung

1. TikTok-Links (einer pro Zeile) einfügen, "Clips hinzufügen" klicken.
2. Warten bis alle Clips den Status "ready" haben (Thumbnail + Dauer erscheinen).
3. Optional einen **Gesamttitel** fürs Ranking eintragen (z.B. "RANKING BEST
   PARKOUR FAILS") — erscheint als Kopfzeile auf jedem Clip im Endvideo.
   Unter dem Textfeld erscheint der Titel als anklickbare Wort-Chips: **ein
   Wort anklicken öffnet einen Farbwähler** (z.B. Rot oder Gelb für einzelne
   Wörter), nochmal anklicken erlaubt eine andere Farbe, der kleine "×" setzt
   es zurück auf Weiß. Schriftart und -größe gelten einheitlich für den
   gesamten Titel (eigene Dropdown-/Zahlen-Felder daneben). Emojis im
   Gesamttitel und in den Clip-Titeln erscheinen farbig im Video.
4. Reihenfolge per Drag & Drop am Griff **⠿** festlegen — sie bestimmt die
   Abspielreihenfolge im Video. Standardmäßig bekommt der **oberste** Clip
   die höchste Platznummer, der **unterste** Clip ist **#1** (klassisches
   Countdown-Format). Die Platznummer lässt sich direkt daneben frei
   überschreiben (z.B. für Lücken wie #10, #7, #3, oder um Platz 4 zuerst
   abzuspielen) — leeres Feld setzt sie zurück auf die automatische,
   positionsbasierte Nummer. Automatische Nummern überspringen dabei
   manuell vergebene Plätze, sodass keine Nummer doppelt vorkommt.
   Alle Platznummern sind während des ganzen Videos permanent links im Bild
   sichtbar, **aufsteigend sortiert** (#1 oben, höchster Platz unten). Der
   Titel eines Clips erscheint in dieser Liste, sobald der Clip in der
   Wiedergabe an der Reihe war/ist — beim letzten Clip ist die Liste dadurch
   vollständig gefüllt. Die Plätze **1, 2, 3** erscheinen immer in **Gold,
   Silber, Bronze**. Der gerade laufende Clip ist zusätzlich hervorgehoben:
   größer und in seiner Rangfarbe (Gold/Silber/Bronze, ab Platz 4 Rot).
5. Pro Clip **Start/Ende in Sekunden** eintragen, um nur einen Ausschnitt ins
   Endvideo zu übernehmen (Default: ganzer Clip). Ende leer lassen = bis zum
   Clipende. Über den Button **"Vorschau"** lässt sich der Clip direkt im
   Browser abspielen; die Buttons **"Start hier setzen"** / **"Ende hier
   setzen"** übernehmen die aktuelle Abspielposition des Vorschau-Players in
   die Start-/Ende-Felder.
6. Optional pro Clip einen kurzen Titel eintragen. Dieser erscheint **nur**
   in der Rangliste (Punkt 4), sobald der Clip "aufgedeckt" ist — nicht im
   Video selbst.
7. "Video rendern" klicken. Das fertige Video liegt danach unter
   `data/output/final_<timestamp>.mp4` und kann im Browser direkt angeschaut
   oder heruntergeladen werden. Es erscheint außerdem automatisch im
   **YouTube Planer** (Umschalter oben auf der Seite bzw. Button direkt unter
   dem fertigen Video), bereit zum Einplanen.
8. Neues Ranking beginnen: **"Ranking zurücksetzen"** (rechts neben der
   Clip-Überschrift) entfernt nach einer Rückfrage alle Clips samt
   heruntergeladener Dateien, leert Gesamttitel und Wortfarben und setzt den
   **Startscreen samt Sprachaufnahme** zurück (sonst läse der Vorspann des
   nächsten Videos den Text des vorherigen vor). Schriftart/-größe und
   bereits gerenderte Videos im Planer bleiben erhalten. Während eines
   Renders ist das Zurücksetzen gesperrt.

### Startscreen (optional)

Auf der Ranking-Seite lässt sich ein **Startscreen** vor den ersten Clip
schalten: Der Gesamttitel erscheint groß und mittig über dem
weichgezeichneten ersten Clip, danach läuft direkt Clip 1.

- **Ein/Aus** per Häkchen, **Mindestdauer** einstellbar (1–10 s, Standard 2 s).
- Optional liest deine **Voicebox-Stimme** einen Text vor. Dann richtet sich die
  Länge automatisch nach der Aufnahme (Aufnahme + 0,4 s, mindestens die
  eingestellte Dauer), und der Startscreen wird automatisch aktiviert.
- Ohne Stimme bekommt der Startscreen eine stille Tonspur — nötig, damit das
  verlustfreie Zusammenhängen mit den Clips funktioniert.
- Der Titel wird automatisch umbrochen und verkleinert, wenn er sonst zu breit
  oder zu hoch würde; Wortfarben und Emojis gelten wie in der Kopfzeile.

## Schnitt — freier Zusammenschnitt (`/edit.html`)

Für Videos **ohne** Ranking-Overlay: beliebige Clips aneinanderhängen, trimmen,
Musik und eine vorgelesene Sprachspur darunterlegen.

1. **Clips holen:** per Link (TikTok, YouTube, …) oder **vom Rechner hochladen**
   (MP4, MOV, WEBM, MKV, M4V).
2. **Reihenfolge** am Griff **⠿** ziehen, pro Clip **Start/Ende** setzen —
   inklusive Vorschau mit "Start/Ende hier setzen".
3. **Format wählen:** Hochkant 9:16 (Shorts/Reels/TikTok), Quer 16:9 oder
   Quadratisch 1:1. Alle Clips werden auf dieses Format gebracht.
4. **Musik** (optional): Audiodatei hochladen, Lautstärke einstellen. Sie läuft
   in Schleife bis zum Videoende.
5. **Text vorlesen lassen** (optional): Text eingeben, Stimme wählen, fertig —
   die Sprachspur startet am Videoanfang. Dafür muss **Voicebox laufen**
   (`.\server.ps1 start voicebox`) und dort ein **Stimmprofil** angelegt sein.
   Die erste Erzeugung lädt das Sprachmodell herunter und dauert entsprechend.
6. **Video rendern** → landet in derselben Videobibliothek wie die
   Ranking-Videos und damit direkt im **YouTube Planer**.

Technisch dasselbe Zwei-Pass-Verfahren wie beim Ranking (normalisieren →
verlustfrei zusammenhängen); Musik und Stimme werden in einem dritten Durchgang
untergemischt (Video wird dabei nur durchgereicht). Ranking-Render und Schnitt
teilen sich ffmpeg, deshalb läuft immer nur einer von beiden.

## YouTube Planer — automatischer geplanter Upload

Über "YouTube Planer" (`/schedule.html`) lässt sich jedes fertig gerenderte
Video mit Titel/Beschreibung/Tags versehen und per Drag & Drop auf einen
Kalender-Zeitpunkt ziehen. Das Tool lädt es daraufhin **sofort** als **privates**
Video zu YouTube hoch und setzt YouTubes eigenes "Veröffentlichen am"-Feld auf
den gewählten Zeitpunkt — YouTube macht es dann selbstständig pünktlich
öffentlich. Der Rechner muss zur eigentlichen Veröffentlichungszeit nicht
laufen; ein unterbrochener Upload (App war zu, kein Internet) wird beim
nächsten Start und danach alle 5 Minuten automatisch erneut versucht —
solange der geplante Zeitpunkt noch in der Zukunft liegt. Ist er inzwischen
verstrichen, wird das Video als Fehler markiert und muss neu eingeplant
werden (YouTube akzeptiert keinen Veröffentlichungszeitpunkt in der
Vergangenheit). Titel (max. 100 Zeichen, keine `< >`), Beschreibung (max.
5000 Bytes) und Tags (zusammen max. 500 Zeichen; Tags mit Leerzeichen zählen
zwei Zeichen extra) werden schon beim Einplanen geprüft — YouTube lehnt
ungültige Metadaten sonst erst **nach** dem vollständigen Datei-Upload ab und
verbrennt dabei Tageskontingent. Aus demselben Grund gibt das Tool nach **drei
erfolglosen Versuchen** auf, statt es endlos alle 5 Minuten zu wiederholen;
neu einplanen startet den Zähler zurück.

Den Kanalnamen zeigt der Planer nicht an: Das Tool fordert bewusst nur die
Upload-Berechtigung (`youtube.upload`) an, und die erlaubt keinen
Lesezugriff auf Kanaldaten.

### Einmalige Einrichtung bei Google (bevor der Planer nutzbar ist)

1. [Google Cloud Console](https://console.cloud.google.com/) → neues Projekt
   anlegen → **YouTube Data API v3** aktivieren ("APIs & Dienste" →
   "Bibliothek").
2. "APIs & Dienste" → **Google Auth Platform** (seit 2024 der neue Name für
   den frühere "OAuth-Zustimmungsbildschirm", aufgeteilt in mehrere Tabs):
   - Tab **"Branding"**: Nutzertyp **Extern**. **App-Name:** frei wählbar,
     darf aber laut Google-Richtlinie **kein** "YouTube"/"Google" enthalten
     (wird sofort beim Speichern abgelehnt) — z.B. einfach
     `Ranking Clips Planer`.
   - Tab **"Audience"**: dich selbst unter "Test users" hinzufügen.
     Anschließend dort den **"Publishing status"** von "Testing" auf
     **"In Production"** umstellen (ein einfacher Klick, **keine**
     Google-Verifizierung nötig — Direktlink:
     [console.cloud.google.com/auth/audience](https://console.cloud.google.com/auth/audience)).
     Das ist wichtig: Ohne diesen Schritt läuft dein Zugangs-Token beim
     sensiblen Scope `youtube.upload` nach 7 Tagen ab und du müsstest dich
     wöchentlich neu anmelden.
3. Tab **"Clients"** (bzw. "Anmeldedaten") → **OAuth-Client-ID erstellen** →
   Typ **Web-Anwendung** → als Redirect-URI exakt einfügen:
   `http://localhost:3000/auth/youtube/callback`
4. Client-ID und Client-Secret kopieren, auf der Planer-Seite eintragen,
   "Speichern" klicken, dann "Mit YouTube verbinden" klicken und den
   Google-Anmeldedialog durchlaufen (inkl. Klick durch die "Google hat diese
   App nicht überprüft"-Warnung — das ist bei einer nur selbst genutzten App
   normal und unbedenklich).
5. **Compliance-Audit beantragen:** Neue/unauditierte API-Projekte setzen
   alle per API hochgeladenen Videos automatisch auf **privat** — dauerhaft,
   unabhängig vom geplanten Veröffentlichungszeitpunkt. Formular hier
   ausfüllen: <https://support.google.com/youtube/contact/yt_api_form>
   (laut Erfahrungsberichten ca. 1 Woche Bearbeitungszeit). **Bis der Audit
   durch ist:** hochgeladene Videos bleiben privat, du kannst sie in der
   Zwischenzeit manuell in [YouTube Studio](https://studio.youtube.com) auf
   "öffentlich" stellen, sobald sie erscheinen.

### "In Produktion" vs. volle Verifizierung — zwei unterschiedliche Dinge

Leicht zu verwechseln, deshalb explizit:

- **"Publishing status: In Production"** (Schritt 2 oben) ist ein einfacher
  Toggle ohne Antrag. Er löst ausschließlich das 7-Tage-Ablauf-Problem der
  Refresh-Tokens. **Mehr braucht der Planer im Kern nicht.**
- **Volle Google-Verifizierung inkl. Domain-Eigentumsnachweis** ist ein
  separater, deutlich aufwändigerer Prozess. Er ist nur nötig, damit
  hochgeladene Videos automatisch (statt manuell) öffentlich werden — siehe
  Compliance-Audit in Schritt 5.

**Bekanntes, ungelöstes Problem:** Der Domain-Eigentumsnachweis über Google
Search Console (URL-Prefix-Methode) kann mit "Startseite nicht auf Sie
registriert" fehlschlagen, selbst wenn das Konto dort als Inhaber verifiziert
ist — auch bei mehreren verifizierten Konten und korrektem Eintrag unter
"Authorized domains". Vermutete Ursache: Google verlangt für diesen Check
eventuell eine **Domain-Property-Verifizierung per DNS-Eintrag** statt der
URL-Prefix-Methode — auf einer geteilten `vercel.app`-Subdomain ohne eigene
Domain nicht möglich. Nicht abschließend geklärt.

**Akzeptierter Workaround (aktueller Stand):** Die Domain-Verifizierung wird
nicht weiterverfolgt. Videos bleiben nach dem Upload privat; sie werden
einmalig manuell in YouTube Studio auf "öffentlich" gestellt (Schritt 5).
Für ein Ein-Personen-Tool ist das ein vertretbarer Mehraufwand von wenigen
Klicks pro Video.

### Grenzen

- **Quota:** Ein Upload kostet 1.600 der standardmäßig 10.000 täglichen
  Einheiten → ca. 6 Video-Uploads pro Tag ohne Antrag auf mehr Kontingent.
- Für YouTube Shorts reicht das vom Tool erzeugte 9:16-Format automatisch
  aus. `#Shorts` wird nur an **hochkant** gerenderte Videos angehängt — der
  freie Schnitt kann auch 16:9 und 1:1, dort wäre der Hashtag falsch.
  Uploads über 3 Minuten Länge zählen nicht mehr als Short.
- "Made for Kids" (COPPA-Pflichtangabe) ist pro Video im Planer ankreuzbar,
  Standard ist "Nein" — die rechtliche Einordnung bleibt in deiner
  Verantwortung.

## Hinweis

Das Herunterladen fremder TikTok-Videos zur privaten Weiterverarbeitung kann
gegen TikToks Nutzungsbedingungen verstoßen. Nutzung auf eigene
Verantwortung — analog zu vergleichbaren Tools (z.B. Viblo).

## Technische Hinweise

- `assets/fonts/arialbd.ttf` ist eine lokale Kopie von Arial Bold, die ffmpeg
  für die Rangliste nutzt. Grund: ffmpegs `drawtext`-Filter kann einen
  Laufwerksbuchstaben (`C:\...`) im Font-/Textdateipfad nicht zuverlässig
  escapen, daher rendert das Tool mit dem Projektordner als Arbeitsverzeichnis
  und ausschließlich relativen Pfaden.
- **Wortweise Titel-Einfärbung:** ffmpegs `drawtext` kann nicht mehrere
  Farben in einer Zeile mischen, daher ist jedes Wort des Gesamttitels ein
  eigener `drawtext`-Filter mit eigener x-Position. Da ffmpeg die berechnete
  Breite eines Filters keinem anderen Filter zur Verfügung stellt, misst das
  Tool die Wortbreiten selbst — über `opentype.js` (reines JS, liest die
  echten Font-Metriken direkt aus der `.ttf`-Datei) statt einer Schätzung.
  Passt der Titel bei der gewählten Größe nicht in die Breite, wird die
  Schriftgröße automatisch (einheitlich für alle Wörter) verkleinert.
  Titel-Filter werden einmal pro Rendering berechnet und für alle Clips
  wiederverwendet, da der Gesamttitel auf jedem Clip identisch ist.
- Die Platznummer wird pro Clip als `rankOverride` gespeichert (`null` =
  automatisch aus der Position berechnet). Drag & Drop ändert nur die
  Abspielreihenfolge, nie eine bereits manuell gesetzte Nummer.
- Trimming (`trimStart`/`trimEnd`, Sekunden) wird als `-ss`/`-to` **vor** dem
  `-i` an ffmpeg übergeben (Input-Seeking). Das ist deutlich schneller als
  Output-seitiges Trimmen und, da ohnehin neu kodiert wird, trotzdem
  bildgenau. Ein Ende ≤ Start wird als "bis zum Clipende" behandelt (ffmpeg
  würde sonst abbrechen).
- Alle Zwischen-Clips werden auf exakt dasselbe Format gebracht (1080×1920,
  SAR 1:1, yuv420p, 30 fps, AAC-Stereo 44,1 kHz) — Clips **ohne Tonspur**
  bekommen eine stille Spur, sonst scheitert der verlustfreie Concat.
  Zwischendateien in `data/output/tmp` werden nach jedem Render gelöscht.
- Alle `drawtext`-Filter nutzen `expansion=none`, damit Zeichen wie `%` im
  Titel als normaler Text erscheinen.
- Die permanente Rangliste ist **aufsteigend nach Platznummer sortiert**
  (unabhängig von der Abspielreihenfolge) und wächst linear nach unten
  (`y = 360 + Index * 108px`, Schrift 52px, aktiver Eintrag 72px; der
  Gesamttitel steht bei `y = 170`). Oben und unten bleibt bewusst Platz, weil
  YouTube Shorts dort Bedienelemente bzw. Kanalname/Beschreibung einblendet.
  Ab ca. 12 Clips werden Abstände und Schriftgröße automatisch gestaucht,
  damit die Liste in diesem Bereich bleibt. Ob ein Clip
  "aufgedeckt" ist (Titel sichtbar), wird über seinen Index in der
  Abspiel-Reihenfolge bestimmt (`Index <= aktueller Index`), nicht über seine
  Platznummer — Titel-Text pro Listeneintrag wird auf 22 Zeichen gekürzt
  (ein Emoji zählt dabei als ein Zeichen).
- **Farbige Emojis:** ffmpegs `drawtext` zeichnet Emoji-Glyphen nur einfarbig
  in der Schriftfarbe (auch mit Segoe UI Emoji). Emojis werden daher als
  Bilder (Google Noto Emoji, Apache-2.0) per `overlay` aufgelegt; Text läuft
  mit `y_align=baseline`, sodass Text und Emoji auf derselben Grundlinie
  stehen. Die PNGs (128 px) werden beim ersten Gebrauch einmalig von jsDelivr
  geladen und in `data/emoji-cache/` gespeichert — danach geht es offline.
  Ist ein Emoji nicht verfügbar (offline beim ersten Mal, unbekanntes Emoji),
  wird es weggelassen.
- Schriftart/-größe des Gesamttitels liegen in `data/settings.json`
  (`titleFont`, `titleFontSize`), Wortfarben in `titleWordColors`
  (Wortindex → Hexfarbe). 6 Schriftarten stehen lokal in `assets/fonts/`
  bereit (Arial Bold, Impact, Comic Sans Bold, Arial Black, Bahnschrift,
  Georgia Bold) — weitere lassen sich in `src/services/fonts.js` ergänzen
  (Datei muss im Projektordner liegen, siehe Escaping-Hinweis oben). Kann
  `opentype.js` eine Schrift nicht vollständig verarbeiten (z.B.
  Bahnschrift), misst das Tool die Breiten ersatzweise direkt über die
  Glyph-Breiten und Kerning-Paare.
- Die gebündelten Schriften sind Microsoft-Schriften (Arial, Impact, …) —
  für die lokale Nutzung unproblematisch, in einem **öffentlichen**
  Repository aber lizenzrechtlich heikel.
- Die Videovorschau lädt die Originaldatei erst bei Klick auf "Vorschau"
  (`preload="none"`), um nicht alle Clips gleichzeitig zu laden.
- **YouTube-Zugangsdaten/Tokens** liegen unverschlüsselt in
  `data/youtube_credentials.json` und `data/youtube_token.json` (beide in
  `.gitignore`) — für ein rein lokales Single-User-Tool ausreichend, aber
  nicht für eine Mehrbenutzer- oder Cloud-Umgebung gedacht.
- Der YouTube-Planer (`public/schedule.html`/`schedule.js`) pollt den
  Server alle 5 Sekunden für Upload-Status-Updates, rendert dabei aber nur
  neu, wenn sich Daten tatsächlich geändert haben **und** kein Formularfeld
  der Bibliothek/des Kalenders gerade fokussiert ist — sonst würde ein Poll
  mitten im Tippen (Titel/Beschreibung/Tags) das Eingabefeld zerstören.
- Der Wochenkalender zeigt feste Stunden-Slots 06:00–23:00 (kein 24h-Bereich,
  kein Minuten-Raster beim Ziehen) — die genaue Uhrzeit lässt sich nach dem
  Ablegen über Klick auf die Zeitanzeige der Karte nachjustieren.

## Basis-Version — bewusst weggelassen

Dies ist eine bewusst schlanke erste Version. Nicht enthalten (könnten bei
Bedarf ergänzt werden): mehrere Projekte parallel, Accounts, Vorlagen/Themes,
automatische Untertitel, Batch-Export, Trimmen per
Zeitleisten-Scrubber (aktuell Vorschau-Video + Zahlen-Eingabe), automatischer
Zeilenumbruch bei sehr langen Gesamttiteln, mehrzeilige Gesamttitel,
Minuten-genaues Kalender-Raster, Upload zu mehreren YouTube-Kanälen,
wiederverwendbare Beschreibungs-/Tag-Vorlagen.

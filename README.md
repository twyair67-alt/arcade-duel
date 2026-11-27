# ARCADE DUEL

Gioco arcade 2D browser senza framework o dipendenze client-side. Il server Node.js serve i file statici, gestisce matchmaking, partite classificate/amichevoli, lobby private e tornei, e conserva profili e classifiche in `server/game-data.json`.

## Avvio

1. Installa Node.js 18 o successivo.
2. Da `server/`, esegui `npm ci`, `npm test` e poi `npm start`.
3. Apri `http://localhost:8080` nel browser. Per una partita online, avvia una seconda finestra o un secondo dispositivo collegato allo stesso server.

Allenamento e partite offline contro CPU funzionano anche senza server. Le partite offline salvano XP e record CPU in locale e sincronizzano una coda quando la connessione torna disponibile. WebSocket e classifiche globali usano automaticamente l'host e il protocollo della pagina; per un server separato puoi configurare `window.ARCADE_SERVER_URL` (WebSocket) e `window.ARCADE_SERVER_HTTP` (API HTTP).

Per l'hosting Node.js, configura il servizio per eseguire `npm start` dalla cartella `server/`; il server usa la porta assegnata tramite `PORT` e gestisce HTTP e WebSocket sullo stesso endpoint. I profili, il Rank, i record CPU e i dati ufficiali sono scritti atomicamente in `server/game-data.json`; su Render collega un disco persistente e, se necessario, imposta `ARCADE_DATA_FILE` al percorso del volume. Senza volume i dati del container possono essere effimeri.

## App Android

Il client Capacitor in `android-app/` carica direttamente il gioco online su Render e non avvia un server locale sul dispositivo. I requisiti Android, la sincronizzazione, l'avvio su emulatore/telefono e la creazione di APK/AAB sono descritti in [android-app/README.md](./android-app/README.md).

## Pubblicazione su Render o Railway

- Crea un servizio Web Service Node.js dal repository e imposta **Root Directory** a `server`.
- **Build Command:** `npm ci`; **Start Command:** `npm start`.
- Node.js 18 o successivo; Render fornisce `PORT`, che il server usa senza una porta fissa.
- Il client usa `wss://` automaticamente dietro HTTPS e interroga la classifica sullo stesso host.
- Aggiungi un disco persistente con mount path `/var/data` e imposta `ARCADE_DATA_FILE=/var/data/game-data.json` per conservare profili e classifiche dopo riavvii e redeploy. Il server crea la cartella se manca; se la scrittura fallisce, registra l'errore e continua temporaneamente in memoria.
- Come **Health Check Path** usa `/api/rankings`; dopo il deploy deve rispondere HTTP 200.
- Il test locale della persistenza si esegue con `npm test` dalla cartella `server/`.

## Modalità e controlli

- **Allenamento**: contro CPU, senza XP o statistiche ufficiali.
- **Partita offline CPU**: seleziona CPU semplice/media/difficile; le vittorie assegnano rispettivamente 15/30/55 XP CPU. Questi XP sono separati dal Rank ufficiale.
- Mouse: mira sul canvas; clic sinistro spara; clic destro schiva; `R` ricarica; `Spazio` attiva l'abilità.
- Touch: trascina sul pad **MIRA**, poi tocca **SPARA**; **RELOAD**, **SKILL**, **SCHIVA** e le quattro emote sono pulsanti separati.
- Il roster salva la navicella scelta in locale; le cinque navicelle hanno 12 punti attributo ciascuna.

Le armi vettoriali sono il fallback automatico. Gli sprite facoltativi si collocano in `assets/weapons/weapon-left.png` e `assets/weapons/weapon-right.png`; dettagli e configurazione varianti sono in `assets/README.txt`.

Allenamento non assegna XP né registra risultati. Le partite offline CPU assegnano XP CPU separati dal Rank ufficiale e sincronizzano la coda locale dopo l'autenticazione del profilo. Solo il matchmaking classificato aggiorna Rank e statistiche ufficiali; amichevoli, codici invito e tornei privati non alterano il Rank. Una stanza amichevole con codice avvia automaticamente la partita quando entra il secondo giocatore; il requisito minimo di quattro partecipanti si applica solo ai tornei privati, che l'host avvia dalla lobby. I tornei pubblici sono mostrati come “COMING SOON”.

## Licenza

Distribuito sotto la licenza MIT. Vedi [LICENSE](./LICENSE).

# ARCADE DUEL

Gioco arcade 2D browser senza framework o dipendenze client-side. Il server Node.js serve anche i file statici, gestisce il matchmaking 1v1 e conserva la classifica globale in `server/leaderboard.json`.

## Avvio

1. Installa Node.js 18 o successivo.
2. Da `server/`, esegui `npm install` e poi `npm start`.
3. Apri `http://localhost:8080` nel browser. Per una partita online, avvia una seconda finestra o un secondo dispositivo collegato allo stesso server.

La modalità **VS CPU** funziona anche senza server. WebSocket e classifica usano automaticamente l'host e il protocollo della pagina; per un server separato puoi configurare `window.ARCADE_SERVER_URL` (WebSocket) e `window.ARCADE_SERVER_HTTP` (classifica HTTP).

Per l'hosting Node.js, configura il servizio per eseguire `npm start` dalla cartella `server/`; il server usa la porta assegnata tramite `PORT` e gestisce HTTP e WebSocket sullo stesso endpoint. Usa un disco persistente se vuoi conservare `server/leaderboard.json` tra i riavvii del servizio.

## Pubblicazione su Render o Railway

- Crea un servizio Node.js dal repository, con la root del progetto come directory di lavoro.
- Comando build: `cd server && npm install`.
- Comando start: `cd server && npm start`.
- Node.js 18 o successivo; il provider deve impostare `PORT` e inoltrare gli upgrade WebSocket.
- Il client usa `wss://` automaticamente dietro HTTPS e interroga la classifica sullo stesso host.
- Collega un volume persistente alla directory `server/` se vuoi mantenere `leaderboard.json` dopo riavvii o ridistribuzioni. Senza volume, lo storage locale del container può essere effimero.

## Controlli

- Mouse: mira sul canvas; clic sinistro spara; clic destro schiva.
- Tastiera: Spazio spara, Shift schiva. I tasti Enter/0 e Freccia giù/Punto sono le alternative P2.
- Touch: trascina sul controllo **SPARA** per mirare e rilascia per sparare; **SCHIVA** attiva il freno tattico.

Le armi vettoriali sono il fallback automatico. Gli sprite facoltativi si collocano in `assets/weapons/weapon-left.png` e `assets/weapons/weapon-right.png`; dettagli e configurazione varianti sono in `assets/README.txt`.

Le partite CPU non aggiornano record. Le partite 1v1 completate aggiornano il record locale e quello globale. Il globale è scritto su disco dal server; il locale è in `localStorage`.

## Licenza

Distribuito sotto la licenza MIT. Vedi [LICENSE](./LICENSE).

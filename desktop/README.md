# ARCADE DUEL Desktop

Client Electron per Windows: include una copia sincronizzata dei file web dalla root del repository; matchmaking e classifiche online continuano a usare Render. Il client locale si avvia anche se il sito è irraggiungibile; le modalità offline restano disponibili.

## Avvio in test

Da PowerShell, nella cartella `desktop/`:

```powershell
npm.cmd ci
npm.cmd start
```

La finestra di gioco è dimensionabile, supporta fullscreen e usa WebAudio, mouse e tastiera. Il comando sincronizza prima HTML, CSS, JavaScript e asset dalla root.

## Pacchetto Windows

Su Windows, dalla stessa cartella:

```powershell
npm.cmd ci
npm.cmd run dist:win
```

L'installer NSIS x64 viene creato in `desktop/dist/release/`. I file web sono inclusi nelle risorse dell'app e aggiornati automaticamente prima del packaging.

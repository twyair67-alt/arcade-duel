# ARCADE DUEL Desktop

Client Electron per Windows: carica `https://arcade-duel.onrender.com/` e non avvia un server locale. Se Render è in sospensione, mostra una schermata d'attesa e riprova automaticamente con intervalli crescenti; **RIPROVA ORA** avvia un nuovo tentativo.

## Avvio in test

Da PowerShell, nella cartella `desktop/`:

```powershell
npm.cmd ci
npm.cmd start
```

La finestra di gioco è dimensionabile, supporta fullscreen e usa la pagina remota con WebAudio, mouse e tastiera.

## Pacchetto Windows

Su Windows, dalla stessa cartella:

```powershell
npm.cmd ci
npm.cmd run dist:win
```

L'installer NSIS x64 viene creato in `desktop/dist/`.

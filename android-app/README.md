# ARCADE DUEL per Android

Client Capacitor che apre direttamente `https://arcade-duel.onrender.com/`: non installa né avvia un server sul telefono. `server.url` è impostato in `capacitor.config.json`; una schermata nativa comunica l'attesa mentre il server si connette, e `server.errorPath` mostra retry progressivi se il WebView riceve un errore temporaneo. Il layout del gioco supporta già portrait e landscape. L'app lascia l'orientamento automatico, usa immersive full screen e il primo tocco sblocca l'audio Web Audio del gioco.

Nota: la documentazione Capacitor descrive `server.url` come opzione pensata principalmente per live reload e non raccomandata per le release. Qui viene usata perché l'app deve caricare il sito Render remoto; ciò rende l'avvio e il gioco dipendenti dalla disponibilità del servizio e dalle policy dello store. Per una release pubblica, verifica i requisiti Google Play per le app WebView e considera di includere il client web nel pacchetto, mantenendo online matchmaking e classifica.

## Requisiti

- Node.js 22 o successivo e npm.
- Android Studio aggiornato, Android SDK Platform Tools, almeno una Android SDK Platform e JDK 21 (Android Studio include un JDK).
- Per un dispositivo fisico: debug USB e autorizzazione del computer sul telefono.

## Installazione e sincronizzazione

Da PowerShell:

```powershell
cd C:\Users\SAMUELE\Desktop\springing\android-app
npm.cmd ci
npm.cmd run android:sync
```

La piattaforma Android è già inclusa nel progetto. Se in una copia nuova la cartella `android/` non è presente, esegui una sola volta `npm.cmd run android:add` prima di `npm.cmd run android:sync`. Ripeti la sincronizzazione dopo modifiche alla configurazione o ai sorgenti web/Capacitor.

## Avvio in Android Studio o su dispositivo

```powershell
npm.cmd run android:open
```

In Android Studio attendi la sincronizzazione Gradle, seleziona un emulatore o un dispositivo connesso e premi **Run**. In alternativa:

```powershell
npm.cmd run android:run
```

Per creare un APK debug installabile:

```powershell
npm.cmd run android:apk:debug
```

Output: `android\app\build\outputs\apk\debug\app-debug.apk`.

## Release APK/AAB

Per Google Play è preferibile un **AAB** firmato. In Android Studio usa **Build > Generate Signed Bundle / APK**, seleziona **Android App Bundle** (oppure APK per distribuzione diretta), crea o seleziona una keystore e completa la procedura. Conserva la keystore e le password in modo sicuro: non inserirle nel repository.

La build CLI non firmata è disponibile con:

```powershell
npm.cmd run android:bundle:release
```

Output AAB: `android\app\build\outputs\bundle\release\app-release.aab`. Per pubblicare, firma l'AAB; per distribuire un APK direttamente, genera un APK firmato in Android Studio.

## Permessi e test rete

Capacitor include `android.permission.INTERNET` nel manifest generato; non serve un permesso runtime. L'app richiede una connessione internet. HTTPS e `wss://` sono usati senza abilitare traffico HTTP in chiaro; il WebSocket e la classifica continuano a usare l'origine Render della pagina. Su emulatore verifica che abbia accesso a Internet; su telefono disattiva temporaneamente il Wi-Fi per provare la schermata offline e riattivalo per verificare il retry. Il primo risveglio di Render può richiedere almeno 50 secondi.

Per ispezionare `console` ed errori WebView durante lo sviluppo, abilita temporaneamente `webContentsDebuggingEnabled` nella configurazione Android, sincronizza e usa `chrome://inspect` da Chrome desktop. L'opzione va mantenuta disattivata nelle release.

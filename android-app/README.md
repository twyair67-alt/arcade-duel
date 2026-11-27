# ARCADE DUEL per Android

Client Capacitor che include HTML, CSS, JavaScript e asset sincronizzati dalla root del repository; matchmaking e classifiche online continuano a collegarsi a Render. L'avvio e le modalità offline non dipendono dal caricamento del sito remoto. Il layout supporta portrait e landscape, l'app lascia l'orientamento automatico, usa immersive full screen e il primo tocco sblocca l'audio Web Audio.

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

`android:sync` copia sempre i sorgenti web correnti in `www/` e poi esegue Capacitor Sync. La piattaforma Android è già inclusa nel progetto. Se in una copia nuova la cartella `android/` non è presente, esegui una sola volta `npm.cmd run android:add` prima di `npm.cmd run android:sync`.

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

Il comando sincronizza di nuovo i sorgenti web prima di Gradle. Output: `android\app\build\outputs\apk\debug\app-debug.apk`.

## Release APK/AAB

Per Google Play è preferibile un **AAB** firmato. In Android Studio usa **Build > Generate Signed Bundle / APK**, seleziona **Android App Bundle** (oppure APK per distribuzione diretta), crea o seleziona una keystore e completa la procedura. Conserva la keystore e le password in modo sicuro: non inserirle nel repository.

La build CLI non firmata è disponibile con:

```powershell
npm.cmd run android:bundle:release
```

Output AAB: `android\app\build\outputs\bundle\release\app-release.aab`. Per pubblicare, firma l'AAB; per distribuire un APK direttamente, genera un APK firmato in Android Studio.

## Permessi e test rete

Capacitor include `android.permission.INTERNET` nel manifest generato; non serve un permesso runtime. Le modalità offline funzionano senza rete; matchmaking e classifiche richiedono internet e usano HTTPS/`wss://` verso Render. Su emulatore verifica che abbia accesso a Internet.

Per ispezionare `console` ed errori WebView durante lo sviluppo, abilita temporaneamente `webContentsDebuggingEnabled` nella configurazione Android, sincronizza e usa `chrome://inspect` da Chrome desktop. L'opzione va mantenuta disattivata nelle release.

# Google Drive nella fork

Questa versione conserva esportazione/importazione XML, esempi, backup locale,
recupero dei vecchi progetti nel browser e gli altri formati di esportazione.
Snap!Cloud è stato scollegato: non vengono più inizializzate sessioni né inviate
credenziali o progetti alle sue API. I vecchi link `#present:`, `#cloud:` e `#dl:`
mostrano un messaggio; i progetti esistenti si possono esportare dal sito originale
e importare come XML. L'API JavaScript per incorporare l'editor rimane disponibile.

## Configurazione Google

1. Crea o seleziona un progetto nella [Google Cloud Console](https://console.cloud.google.com/).
2. Abilita **Google Drive API**.
3. Configura Google Auth Platform: nome dell'app, contatti e pubblico interno
   (se consentito dal tuo Google Workspace) oppure esterno. In modalità di test,
   aggiungi gli account che devono provare l'app agli utenti di test.
4. Configura il permesso `https://www.googleapis.com/auth/drive.file`.
   Nella sezione Branding usa questi URL pubblici, dopo aver pubblicato i file:

   - Home page: `https://prof-davidaffo.github.io/Snap/about.html`
   - Privacy: `https://prof-davidaffo.github.io/Snap/privacy.html`
   - Termini: `https://prof-davidaffo.github.io/Snap/terms.html`

5. Crea un client OAuth di tipo **Applicazione web**. Aggiungi alle origini
   JavaScript autorizzate l'origine HTTPS dell'editor, senza percorsi.
   Per esempio: `https://prof-davidaffo.github.io`, non `/Snap/snap.html`.
   Per lo sviluppo puoi aggiungere `http://localhost:8000`.
6. Incolla il client ID pubblico in `config.js`:

   ```js
   window.SNAP_CONFIG = {
       googleClientId: 'IL-TUO-CLIENT-ID.apps.googleusercontent.com'
   };
   ```

Non inserire client secret, password o token nel repository. Il flusso browser
non usa un client secret. Se gli account scolastici hanno restrizioni sulle app
OAuth, l'amministratore Workspace deve consentire l'app. Per l'accesso pubblico,
completa la configurazione e gli eventuali requisiti di pubblicazione mostrati
dalla console Google: la modalità di test non è una distribuzione definitiva.

Per avviare il server statico dalla cartella `Snap`:

```sh
python -m http.server 8000
```

Apri `http://localhost:8000/snap.html`. Da un tablet remoto occorre un indirizzo
HTTPS autorizzato: il semplice indirizzo HTTP della macchina sulla LAN non è
un contesto sicuro. L'editor locale resta utilizzabile anche senza Google.

## Uso e comportamento

- Dal pulsante cloud scegli **Accedi con Google**. Per cambiare account,
  disconnetti quello attuale e accedi di nuovo.
- I dialoghi **Apri** e **Salva con nome** includono Google Drive; le azioni sono
  disponibili anche nel menu progetto. **Computer**, **Esempi** e recupero
  **Browser** mantengono il comportamento precedente.
- I progetti vengono salvati nel Drive personale come file XML completi, con
  immagini e suoni incorporati. Il caricamento usa il protocollo resumable
  di Google, ma non riprende automaticamente dopo una chiusura della pagina.
- L'elenco mostra i progetti creati da questa integrazione, anche da altri
  dispositivi con lo stesso account e client OAuth. Per importare altri XML,
  usa l'importazione locale e poi salvali su Drive.
- **Salva** aggiorna il file Drive associato al progetto aperto. In **Salva con
  nome**, selezionare un file esistente e mantenerne il nome chiede conferma
  prima della sostituzione; un nome nuovo crea un nuovo file. Due file con lo
  stesso nome restano distinti: non vengono sovrascritti solo per il nome.
- Se si cambia account, non viene mai riutilizzato l'ID di un file appartenente
  al precedente account. Riconnettere lo stesso account dopo la scadenza della
  sessione conserva l'associazione al file del progetto corrente.
- I token e l'identità Google restano solo in memoria. Dopo un ricaricamento o
  la scadenza della sessione serve accedere di nuovo. Non c'è sincronizzazione
  in background né salvataggio automatico su Drive.
- Un errore di rete non segna il progetto come salvato. Si può continuare a
  lavorare, esportare un XML sul dispositivo e riprovare. Le modifiche fatte
  durante un caricamento restano contrassegnate come non salvate.

Non sono incluse le funzioni comunitarie Snap!Cloud (pubblicazione, remix,
cronologia remota); i normali backup locali e le esportazioni restano presenti.

## Verifica

```sh
node tests/tablet-input.test.cjs
node tests/google-drive.test.cjs
node tests/google-drive-ui.test.cjs
```

I test usano risposte OAuth/Drive simulate. Dopo la configurazione, verificare
su browser e tablet: accesso/annullamento, salvataggio con media, riapertura,
aggiornamento dello stesso file, Salva con nome, disconnessione/cambio account,
sessione scaduta, errore di rete e normali salvataggi locali.

Riferimenti: [autorizzazione browser](https://developers.google.com/identity/oauth2/web/guides/use-token-model),
[permesso drive.file](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[caricamento file](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

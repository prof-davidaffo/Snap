# Pubblicazione su GitHub Pages

L'app è statica: la root è già pubblicabile e non richiede npm, build o un
workflow Actions personalizzato. `.nojekyll` fa servire i file senza elaborarli
con Jekyll. Non ci sono link simbolici che richiedano un workflow dedicato.

## Attivazione

1. Porta su GitHub tutte le modifiche, inclusi i nuovi file Google Drive,
   `config.js` e `.nojekyll`, sul branch `master` del repository
   `prof-davidaffo/Snap`.
2. Nel repository apri **Settings → Pages**.
3. In **Build and deployment → Source** scegli **Deploy from a branch**.
4. Seleziona **master** e **/(root)**, quindi premi **Save**.
5. Attendi che GitHub completi la pubblicazione. Il sito previsto, in assenza
   di un dominio personalizzato, è:

   **https://prof-davidaffo.github.io/Snap/**

La pagina iniziale porta a `snap.html` mantenendo parametri e frammento del link.
GitHub usa una propria esecuzione Actions per pubblicare anche in questa
modalità: non serve aggiungere un file workflow nel repository.
I successivi push a `master` aggiornano il sito automaticamente.

## Accesso Google per gli alunni

L'editor e i salvataggi locali funzionano anche se Google non è configurato.
Per attivare Google Drive:

1. Segui [la configurazione Google](GoogleDrive.md) e inserisci l'ID client
   pubblico in `config.js` prima del push.
2. Nel client Google, in **Origini JavaScript autorizzate**, aggiungi
   **https://prof-davidaffo.github.io**. L'origine non include `/Snap/` né
   `/snap.html`.
3. Per account Google di organizzazioni diverse o personali, imposta il pubblico
   **Esterno** e pubblica l'app Google **In produzione**, completando gli
   eventuali requisiti indicati dalla console. Non lasciare la classe in una
   lista di utenti di test. Per un'app interna a una sola organizzazione
   Workspace, l'amministratore può configurare il pubblico **Interno**.
4. Se la scuola limita le applicazioni collegate agli account degli studenti,
   l'amministratore deve autorizzare l'app.
5. Gli alunni aprono il link pubblico e scelgono **Accedi con Google**.

Il sito Pages e l'app Google sono due pubblicazioni distinte. Pubblicare il sito
non attiva automaticamente l'accesso Google.

Per i campi Branding di Google, dopo la pubblicazione delle pagine:

- Home page: `https://prof-davidaffo.github.io/Snap/about.html`
- Privacy: `https://prof-davidaffo.github.io/Snap/privacy.html`
- Termini di servizio: `https://prof-davidaffo.github.io/Snap/terms.html`

Le pagine sono accessibili senza login e collegate anche dai menu dell'editor.
Il tracciamento Matomo ereditato dal progetto originale è stato rimosso.

## Controllo dopo la pubblicazione

- Apri il sito e verifica editor, traduzione italiana, esempi e import/export.
- Dal tablet verifica la modifica del testo nei blocchi.
- Se Google è configurato, salva un progetto con media, riaprilo e aggiorna
  lo stesso file. Prova anche un account studente.
- Dopo la prima apertura online e l'installazione della cache, verifica la
  riapertura offline. Drive richiede comunque la connessione.

I percorsi e il manifest sono relativi alla cartella dell'app. Il service worker
è limitato a `/Snap/`; le sue pulizie della cache non cancellano quelle degli
altri siti pubblicati sullo stesso dominio. Le vecchie cache senza identificativo
di percorso vengono conservate per non cancellare dati di altre installazioni.

Fonti: [sorgente di pubblicazione Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site),
[limiti Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

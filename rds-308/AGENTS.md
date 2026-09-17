# RDS Mod. 0308 — guida per chi continua lo sviluppo (umano o IA)

Questo file va aggiornato a ogni modifica sostanziale della cartella `rds-308/`.
Se stai riprendendo questo progetto con un altro agente (Codex, Copilot, Gemini,
un'altra sessione Claude, ecc.), leggi questo file per primo: ti dà il contesto
che altrimenti è solo nella cronologia della chat originale.

## Cos'è

Web app **portable** (nessuna build, nessuna dipendenza, HTML/CSS/JS serviti
così come sono) per compilare e modificare il **Registro delle Disposizioni di
Servizio** (Modulo 0308) di Ferrovienord, secondo l'Allegato 10 della normativa
ISD (Istruzione per il Servizio dei Deviatori) e la prassi osservata negli RDS
reali già in uso.

Segue lo stesso pattern delle altre app nella cartella principale del repo
(`portable/`, `bordo-treno/`): cartella a sé stante, `server.ps1` (server HTTP
solo su `127.0.0.1`, nessuna rete esterna) + `Avvia RDS.cmd` come launcher.

## Perché esiste (contesto per chi non c'era)

L'utente (Giovanni, Ferrovienord — Gestione Circolazione) lavora **al 99% su
RDS già esistenti** (centinaia di file .docx su SharePoint), non su RDS creati
da zero. Questo ha spostato la priorità dello sviluppo: la funzione più
importante dell'app non è il form vuoto, ma l'**importazione automatica da
Word** di un RDS già scritto, da poter poi verificare/correggere/aggiornare qui
dentro.

## Struttura dei file

| File | Ruolo |
|---|---|
| `index.html` | Shell della pagina: elenco documenti, editor, dialog di import/report, avviso di fallback se aperto senza server. |
| `schema.js` | **La fonte di verità della struttura del documento.** Definisce i due template (`stazione`, `posto_servizio`) come albero di sezioni (`group`/`leaf`), i campi di ogni sezione (`text`, `textarea`, `select`, `table`, `matrix`, `systemlist`) e i campi di "Generalità" con parole chiave (`match`) per il riconoscimento fuzzy in importazione. |
| `render.js` | Renderer generico del form: dato uno schema + un documento, costruisce il DOM editabile. Contiene anche `flattenAll` (appiattisce l'albero in ordine, usato dall'importatore per il matching sequenziale dei titoli). |
| `storage.js` | Persistenza in `localStorage` (CRUD), export/import JSON, `createBlank()` crea un documento vuoto con `reviewStatus: "verificato"`. |
| `print.js` | Vista stampabile (frontespizio, generalità, sezioni, tabelle) per `window.print()` / salvataggio PDF dal browser. |
| `docximport.js` | **Il pezzo più delicato.** Legge un `.docx` (è uno zip: stesso approccio già usato in `portable/app.js` per gli `.xlsx`, nessuna libreria esterna), estrae paragrafi e tabelle da `word/document.xml` **e da `word/header*.xml` / `word/footer*.xml`** (il timbro Edizione/Aggiornamento/Data è quasi sempre lì, non nel corpo), e li assegna alle sezioni giuste riconoscendo i **titoli** (non i numeri, spesso auto-generati da Word e assenti come testo). Espone anche `buildReport()` per il report leggibile post-import.
| `app.js` | Collega tutto: vista elenco, editor, dialog import Word (con select del template), dialog "Report di importazione" con pulsante copia, import/export JSON, stampa. |
| `styles.css` | Stile editor + stile di stampa (`@media print`). |
| `server.ps1` / `Avvia RDS.cmd` | Server locale + launcher, identici nel pattern a `portable/`. |
| `LEGGIMI.txt` | Istruzioni per l'utente finale (non tecniche). |

## Come funziona l'importazione da Word (il cuore dell'app)

`docximport.js` **non** cerca i numeri di sezione (es. "1.2.2") perché in Word
sono spesso generati dalla numerazione automatica delle liste e non compaiono
come testo nel file. Cerca invece i **titoli** delle sezioni, confrontati in
ordine sequenziale con l'indice dello schema (`flattenAll`), avanzando un
cursore solo in avanti: questo risolve da solo i titoli duplicati (es.
"Aggiornamenti" compare sia in Parte Prima che in Parte Seconda) perché il
secondo viene cercato solo dopo aver già superato il primo.

Meccanismo, in breve:
1. Legge `word/document.xml` come sequenza ordinata di paragrafi e tabelle.
2. Legge anche `word/header*.xml` / `word/footer*.xml` per il timbro
   Edizione/Aggiornamento/Entrata in vigore (di solito lì, non nel corpo).
3. La prima tabella prima del primo titolo riconosciuto è il blocco
   "Generalità" (etichetta → valore); il matching delle etichette è
   **tollerante**: prima prova l'uguaglianza esatta con `field.label`, poi
   cade su parole chiave (`field.match`, definite in `schema.js`) perché i
   documenti reali non usano sempre la formulazione esatta della normativa
   (es. "Struttura di giurisdizione" invece di "Struttura avente
   giurisdizione").
4. Ogni paragrafo/tabella successivo viene assegnato alla sezione dell'ultimo
   titolo riconosciuto, finché non ne arriva uno nuovo.
5. Testo che corrisponde esattamente a "Per memoria." marca la sezione come
   non applicabile (stesso comportamento dei documenti ufficiali).
6. Le tabelle vengono mappate **posizionalmente** (colonna N del documento →
   colonna N dello schema), saltando la riga di intestazione.
7. Se una tabella non corrisponde a nessun campo previsto, non viene scartata:
   se la sezione ha un campo di testo libero viene aggiunta lì come testo
   grezzo; altrimenti il contenuto completo finisce nell'elenco degli avvisi
   (mai silenziosamente perso).
8. Alla fine, `buildReport()` produce un riepilogo testuale copiabile
   (sezione per sezione: vuota / "Per memoria" / quanti campi e righe) più
   l'elenco degli avvisi — pensato per essere incollato in chat a un agente IA
   per la diagnosi, invece di uno screenshot.

**Casi speciali gestiti esplicitamente in `docximport.js`:**
- `3.3.3` (Modulo 0245, Quadro A/B/C nel template `posto_servizio`): il testo
  raccolto viene ri-diviso con una regex su "Quadro A/B/C" perché nei
  documenti reali spesso è un unico paragrafo con tutti e tre inline.
- Sezione `"2"` del template `posto_servizio` (systemlist): non è un albero di
  sotto-sezioni fisse (i sistemi di un DCO variano: SCCT, RTB/RTF, un impianto
  antincendio per ogni galleria di giurisdizione...), quindi viene trattata
  euristicamente — un paragrafo corto senza punteggiatura finale è
  considerato un nuovo titolo di voce, altrimenti è testo della voce
  precedente. **Limite noto**: righe corte non-titolo (es. un indirizzo
  email) possono essere scambiate per un nuovo titolo.
- Matrice funzioni × attività (`3.1.2`, `3.2.2`): se la sezione ha un campo
  `matrix` e nessun campo `table`, la prima tabella trovata viene interpretata
  come matrice (intestazione = agenti, prima colonna = attività, celle
  non vuote/`X`/`SI` = spunta).

## Stato di verifica dei documenti (`reviewStatus`)

Ogni documento ha `reviewStatus`: `"verificato"` (creato da zero, o importato
e poi confermato dall'utente) oppure `"da_verificare"` (appena importato da
Word, non ancora controllato). Badge visibile nell'elenco, con pulsante
"Segna come verificato". **Motivo**: evitare che un import grezzo non
controllato venga scambiato per un documento affidabile.

## Decisioni prese e perché (per non tornare indietro per errore)

- **Portable HTML/JS, non lo stack Next.js/React** già presente nella root del
  repo: quello stack è segnato come "riferimento storico non allineato" nella
  memoria del progetto; per un'app nuova non ha senso ripartire da lì.
- **Import Word prima di tutto**: l'utente lavora al 99% su RDS esistenti, non
  su RDS nuovi. Il form di creazione da zero esiste ma è il caso secondario.
- **Output: stampa/PDF ora, .docx eventualmente in futuro**: l'utente ha
  scelto "entrambi" ma ha dato priorità a stampa/PDF (più semplice, nessuna
  libreria). Se serve riesportare in .docx modificabile da altri in Word, va
  ancora costruito.
- **JSON come formato "vivo" dell'app**, non per condivisione con chi non usa
  l'app. Una volta che un documento importato viene verificato e risalvato in
  JSON, quel JSON diventa la fonte affidabile per quella località di servizio
  (non serve più ripartire dal Word originale, a meno che qualcuno lo
  rimodifichi fuori dall'app).
- **Timbro Edizione/Aggiornamento unico per documento**, non per pagina: nei
  documenti ufficiali cambia pagina per pagina (quali pagine sono state
  ristampate a ogni aggiornamento); qui è semplificato a un solo timbro in
  copertina. La tabella "Aggiornamenti" resta comunque completa.

## Come testare (non c'è una suite automatica)

Non esistono test automatici. La verifica finora è stata manuale, in due modi:

1. **Docx sintetici**: costruiti al volo con PowerShell
   (`System.IO.Compression.ZipFile`) per isolare un singolo meccanismo
   (tabella, matrice, header.xml, matching fuzzy delle etichette...) senza
   dipendere da un file reale. Vedi la cronologia di sviluppo per gli esempi;
   non sono stati conservati nel repo (file temporanei, cancellati dopo l'uso).
2. **Docx reali** forniti dall'utente da SharePoint (cartella
   `RDS mo.308/RDS da rev. 03` su `fnmgroup.sharepoint.com/sites/fn-sc-gc`, e
   il suo specchio in `fn-sc-staff`): il modo più affidabile per trovare bug,
   perché rivela problemi che i test sintetici non anticipano (es. il timbro
   che sta nell'header di Word, non nel corpo — scoperto solo così).

**Se aggiungi funzionalità al parser di importazione**: testalo con un
`.docx` reale prima di considerarlo finito. I test sintetici servono a isolare
un meccanismo, non a validare la fedeltà su un documento vero.

## Limiti noti / cose da non dare per scontate

- L'importazione legge solo `.docx`, non `.pdf` (i .pdf su SharePoint sono
  l'esportazione finale, non la fonte modificabile).
- Il riconoscimento delle sezioni si basa sul **testo del titolo**; se un RDS
  usa titoli molto diversi da quelli della normativa, il contenuto finisce
  nella sezione sbagliata (o resta nel "fronte", prima del primo titolo
  riconosciuto) — sempre segnalato/recuperabile, mai perso silenziosamente,
  ma va corretto a mano.
- Nessun export diretto in `.docx` (solo stampa/PDF e JSON interno).
- Nessun archivio condiviso in rete: i documenti vivono nel `localStorage` del
  browser del PC in uso. Condivisione solo tramite "Esporta JSON" manuale.

## Prossimi passi possibili (non ancora fatti)

- Validare l'importatore su altri RDS reali oltre a Novate Milanese e Milano
  Cadorna (in particolare: un Posto di servizio DCO reale, non solo quello
  sintetico di test).
- Valutare export diretto `.docx` se serve a qualcuno rieditare fuori
  dall'app.
- Timbro Edizione/Aggiornamento per-pagina invece che unico per documento (se
  diventa importante per la fedeltà della stampa).

---
*Ultimo aggiornamento: aggiunta importazione Word con lettura header/footer,
matching fuzzy delle etichette Generalità, fallback testuale per tabelle non
riconosciute, badge di stato verificato/da verificare, report di importazione
copiabile.*

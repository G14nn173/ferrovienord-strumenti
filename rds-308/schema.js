// Schema del Modulo 0308 - Registro delle Disposizioni di Servizio (RDS)
// Fonte: Allegato 10 della normativa ISD (Istruzione per il Servizio dei Deviatori)
// e struttura reale osservata negli RDS pubblicati da Ferrovienord (Rev.03).
//
// Ogni "nodo" di sezione ha:
//   id       - identificativo univoco (usato anche come numerazione visibile)
//   title    - titolo della sezione
//   kind     - 'group' (contiene solo sotto-sezioni) o 'leaf' (contiene campi)
//   children - array di sotto-nodi (solo per i group)
//   fields   - array di campi (solo per i leaf)
//   noPerMemoria - true per le sezioni che non ammettono "Per memoria" (es. tabelle sempre presenti)
//
// Tipi di campo supportati da render.js:
//   'textarea'  - testo libero multilinea
//   'text'      - testo libero su una riga
//   'select'    - scelta singola tra 'options'
//   'table'     - tabella a righe ripetibili, colonne definite in 'columns'
//   'matrix'    - tabella a matrice righe (attività) x colonne (agenti), editabili entrambe

(function (global) {
  "use strict";

  const SI_NO = ["", "SI", "NO"];

  const AGGIORNAMENTI_COLUMNS = [
    { key: "numero", label: "N°", type: "text", width: "60px" },
    { key: "oggetto", label: "Oggetto dell'aggiornamento", type: "text" },
    { key: "pagine_ristampate", label: "Pagine ristampate", type: "text" },
    { key: "pagine_annullate", label: "Pagine annullate", type: "text" },
    { key: "data_vigore", label: "Entrata in vigore", type: "text", width: "140px" },
  ];

  const DOCUMENTAZIONE_COLUMNS = [
    { key: "numero", label: "N°", type: "text", width: "60px" },
    { key: "descrizione", label: "Descrizione dell'allegato", type: "text" },
    { key: "riferimento", label: "Rev. / data / riferimento", type: "text", width: "220px" },
  ];

  function aggiornamentiField(key) {
    return {
      key,
      type: "table",
      label: "Registro degli aggiornamenti",
      columns: AGGIORNAMENTI_COLUMNS,
      addRowLabel: "Aggiungi aggiornamento",
    };
  }

  function documentazioneField(key) {
    return {
      key,
      type: "table",
      label: "Elenco della documentazione complementare",
      columns: DOCUMENTAZIONE_COLUMNS,
      addRowLabel: "Aggiungi allegato",
    };
  }

  function leaf(id, title, fields, opts) {
    return Object.assign(
      { id, title, kind: "leaf", fields: fields || [{ key: "testo", type: "textarea", label: "Contenuto" }] },
      opts || {}
    );
  }

  function group(id, title, children) {
    return { id, title, kind: "group", children };
  }

  // ---- Campi tabella BINARI --------------------------------------------
  const BINARI_TECNICI_COLUMNS = [
    { key: "binario", label: "Binario", type: "text", width: "90px" },
    { key: "funzione", label: "Funzione e utilizzazione", type: "text" },
    { key: "capacita", label: "Capacità (m)", type: "text", width: "100px" },
    { key: "pendenza", label: "Pendenza ‰ e lato", type: "text", width: "140px" },
    { key: "ingombro_uscita", label: "Ingombro all'uscita (paraurti)", type: "select", options: SI_NO, width: "110px" },
    { key: "circuiti_binario", label: "Circuiti di binario (secondari)", type: "select", options: SI_NO, width: "110px" },
    { key: "banchina", label: "Banchina", type: "text", width: "160px" },
    { key: "note", label: "Note", type: "text" },
  ];

  const BINARI_VIAGGIATORI_COLUMNS = [
    { key: "binario", label: "Binario", type: "text", width: "80px" },
    { key: "striscia_sicurezza", label: "Striscia di sicurezza", type: "select", options: SI_NO },
    { key: "tabella_orientamento", label: "Tabella di orientamento", type: "select", options: SI_NO },
    { key: "scale_fisse", label: "Scale fisse", type: "select", options: SI_NO },
    { key: "scale_mobili", label: "Scale mobili", type: "select", options: SI_NO },
    { key: "ascensori", label: "Ascensori", type: "select", options: SI_NO },
    { key: "attraversamenti_raso", label: "Attraversamenti a raso (ubicazione)", type: "text" },
    { key: "sottopassaggi", label: "Sottopassaggi", type: "select", options: SI_NO },
    { key: "sovrappassaggi", label: "Sovrappassaggi", type: "select", options: SI_NO },
    { key: "note", label: "Note", type: "text" },
  ];

  const BINARI_ATTREZZATURE_COLUMNS = [
    { key: "binario", label: "Binario", type: "text", width: "80px" },
    { key: "presa_re", label: "Presa fissa riscaldamento elettrico", type: "select", options: SI_NO },
    { key: "distributore_acqua", label: "Distributore acqua", type: "select", options: SI_NO },
    { key: "distributore_gasolio", label: "Distributore gasolio", type: "select", options: SI_NO },
    { key: "piattaforma_girevole", label: "Piattaforma girevole", type: "select", options: SI_NO },
    { key: "pesa_ponte", label: "Pesa a ponte", type: "select", options: SI_NO },
    { key: "sagoma_limite", label: "Sagoma limite di carico", type: "select", options: SI_NO },
    { key: "piano_caricatore", label: "Piano caricatore", type: "select", options: SI_NO },
    { key: "note", label: "Note", type: "text" },
  ];

  const DEVIATOI_COLUMNS = [
    { key: "numero", label: "N°", type: "text", width: "60px" },
    { key: "armamento", label: "Armamento", type: "text", width: "90px" },
    { key: "vel_max", label: "Vel. max ramo dev. (km/h)", type: "text", width: "110px" },
    { key: "tipo_manovra", label: "Tipo di manovra", type: "select", options: ["", "Elettrica", "A mano"] },
    { key: "tipo_cassa", label: "Tipo di cassa di manovra", type: "text", width: "110px" },
    { key: "fermascambio", label: "Fermascambio (manovra a mano)", type: "text" },
    { key: "cassa_elettrica", label: "Tallonabile/intallonabile (manovra elettrica)", type: "text" },
    { key: "cdb", label: "Circuiti binario immobilizzazione", type: "text", width: "100px" },
    { key: "rfm", label: "Rivelatore fine manovra", type: "select", options: SI_NO },
    { key: "contatto_funghi", label: "Contatto funghi", type: "select", options: SI_NO },
    { key: "tipo_morsa", label: "Tipo fermascambio a morsa", type: "text", width: "110px" },
    { key: "dbd", label: "Dispositivo di bloccaggio", type: "select", options: SI_NO },
    { key: "posizione_normale", label: "Posizione al normale", type: "select", options: ["", "sx", "dx"], width: "90px" },
    { key: "note", label: "Note", type: "text" },
  ];

  function plColumns(withDirezione) {
    const cols = [
      { key: "progressiva", label: "Progressiva km", type: "text", width: "100px" },
      { key: "tratta", label: "Tratta di linea", type: "text" },
      { key: "viabilita", label: "Viabilità di accesso stradale", type: "text" },
      { key: "barriere", label: "Barriere", type: "select", options: SI_NO },
      { key: "manovra_chiusura", label: "Manovra di chiusura", type: "text", width: "110px" },
      { key: "manovra_apertura", label: "Manovra di apertura", type: "text", width: "110px" },
      { key: "dispositivo_liberazione", label: "Dispositivo di liberazione artificiale", type: "text" },
    ];
    if (withDirezione) {
      cols.push({ key: "posto_controllo", label: "Posto di controllo", type: "text", width: "110px" });
    }
    cols.push({ key: "note", label: "Note", type: "text" });
    return cols;
  }

  const PROTEZIONE_PL_COLUMNS = [
    { key: "progressiva", label: "Progressiva km", type: "text", width: "100px" },
    { key: "tratta", label: "Tratta di linea", type: "text" },
    { key: "segnali_protezione", label: "Segnali che proteggono il PL", type: "text" },
    { key: "segnali_luminosi_strada", label: "Segnali luminosi lato strada", type: "select", options: SI_NO },
    { key: "collegamento", label: "Collegamento controllo illuminazione ↔ via libera", type: "select", options: SI_NO },
    { key: "tv", label: "Impianto visualizzazione TV", type: "select", options: SI_NO },
    { key: "pai", label: "Protezione automatica integrativa (PAI-PL)", type: "select", options: SI_NO },
    { key: "posto_controllo", label: "Posto di controllo (barriere automatiche)", type: "text", width: "110px" },
    { key: "note", label: "Note", type: "text" },
  ];

  const RACCORDI_COLUMNS = [
    { key: "denominazione", label: "Denominazione", type: "text" },
    { key: "punto_allacciamento", label: "Punto di allacciamento", type: "text" },
    { key: "indipendenza", label: "Modalità di indipendenza", type: "text" },
    { key: "attrezzature", label: "Attrezzature", type: "text" },
    { key: "condizioni", label: "Condizioni per movimentazione", type: "text" },
    { key: "note", label: "Note", type: "text" },
  ];

  const SEGNALI_COLUMNS = [
    { key: "numero", label: "N° segnale", type: "text", width: "90px" },
    { key: "funzione", label: "Funzione", type: "text", width: "140px" },
    { key: "numero_luci", label: "N° luci", type: "text", width: "70px" },
    { key: "aspetti", label: "Aspetti", type: "text" },
    { key: "ulteriori_segnali", label: "Ulteriori segnali di cui è corredato", type: "text" },
    { key: "note", label: "Note", type: "text" },
  ];

  const RDS_PP_COLUMNS = [
    { key: "denominazione", label: "Posto periferico / RdS", type: "text" },
    { key: "riferimento", label: "Riferimento / collegamento", type: "text" },
  ];

  const SISTEMI_COLUMNS = null; // gestito da 'list' custom, vedi campo 'sistemi'

  function attivitaMatrix(key, agentiDefault, attivitaDefault) {
    return {
      key,
      type: "matrix",
      label: "Tabella funzioni × attività",
      defaultCols: agentiDefault,
      defaultRows: attivitaDefault,
    };
  }

  const ATTIVITA_DM = [
    "Tenuta registro di consegna (mod. 0243)",
    "Visita in cabina / fuori cabina",
    "Custodia chiavi fermascambi e serrature di sicurezza",
    "Compilazione rapporto movimento treni (mod. 0245)",
    "Richiesta intervento personale manutentivo",
    "Compilazione annotazioni guasti/anormalità (mod. 0245)",
    "Prescrizioni di movimento (permanenti e occasionali)",
    "Ricevimento/trasmissione dati composizione treni",
    "Rapporti con DCO",
    "Formazione itinerari (normale/guasto)",
    "Distanziamento treni (blocco elettrico normale/guasto)",
    "Manovra segnali",
    "Presenziamento e accertamento completezza treni",
    "Precedenze e incroci",
    "Effettuazioni/soppressioni/fusioni/sostituzioni treni",
    "Circolazione mezzi d'opera",
    "Trasporti eccezionali e merci pericolose",
    "Interruzioni e disposizioni segnale di fermata",
    "Soccorso treni",
    "Disabilitazione stazione",
    "Rapporti con AM / IF / altri GI",
    "Informazioni al pubblico",
  ];

  const ATTIVITA_DEVIATORI = [
    "Consegne",
    "Pulizia e lubrificazione deviatoi",
    "Visita in cabina / fuori cabina",
    "Compilazione annotazioni guasti (mod. 0245)",
    "Rapporti con altri posti di servizio",
    "Formazione itinerari/istradamenti",
    "Manovra segnali",
    "Presenziamento e accertamento coda treni",
    "Avvisi ai deviatori sulla circolazione dei treni",
  ];

  // ---- Meta / frontespizio ----------------------------------------------
  function metaFields(templateId) {
    const classificazioneOptions =
      templateId === "posto_servizio"
        ? ["Posto di servizio"]
        : ["Stazione", "Posto di comunicazione", "Bivio"];
    return [
      { key: "denominazione", type: "text", label: "Denominazione", match: [["DENOMINAZIONE"]] },
      {
        key: "classificazione",
        type: "select",
        label: "Classificazione",
        options: ["", ...classificazioneOptions],
        match: [["CLASSIFICAZIONE"]],
      },
      {
        key: "struttura_giurisdizione",
        type: "text",
        label: "Struttura avente giurisdizione",
        match: [["STRUTTURA", "GIURISDIZ"]],
      },
      {
        key: "orario_presenziamento",
        type: "text",
        label: "Orario di presenziamento",
        match: [["ORARIO"]],
      },
      {
        key: "caratteristiche_tratta",
        type: "textarea",
        label:
          templateId === "posto_servizio"
            ? "Caratteristiche delle tratte di linea di giurisdizione"
            : "Caratteristiche della tratta di linea",
        match: [["CARATTERISTIC", "TRATT"]],
      },
      {
        key: "sistema_dirigenza",
        type: "text",
        label: "Sistema di dirigenza del movimento",
        match: [["SISTEMA", "DIRIGENZA"]],
      },
      {
        key: "altre_particolarita",
        type: "textarea",
        label: "Altre notizie particolari",
        match: [["ALTRE", "PARTICOLAR"], ["ALTRE", "NOTIZIE"]],
      },
    ];
  }

  // ---- Template STAZIONE -------------------------------------------------
  function buildStazioneTree() {
    return [
      group("1", "Caratteristiche infrastrutturali", [
        group("1.1", "Documentazione relativa all'infrastruttura ferroviaria", [
          leaf("1.1.1", "Piano schematico"),
          leaf("1.1.2", "Profilo schematico"),
          leaf("1.1.3", "Piano schematico di trazione elettrica"),
          leaf("1.1.4", "Planimetria relativa alle intervie"),
          leaf("1.1.5", "Ostacoli a distanza ridotta dal binario"),
          leaf("1.1.6", "Altre rappresentazioni schematiche"),
        ]),
        group("1.2", "Caratteristiche particolari dell'infrastruttura ferroviaria", [
          group("1.2.1", "Binari della località di servizio", [
            leaf(
              "1.2.1.1",
              "Caratteristiche tecniche",
              [
                { key: "binari_circolazione", type: "table", label: "Binari di circolazione", columns: BINARI_TECNICI_COLUMNS, addRowLabel: "Aggiungi binario" },
                { key: "binari_secondari", type: "table", label: "Binari secondari", columns: BINARI_TECNICI_COLUMNS, addRowLabel: "Aggiungi binario" },
                { key: "note_dislocazione_morse", type: "textarea", label: "Note aggiuntive" },
              ],
              { noPerMemoria: true }
            ),
            leaf(
              "1.2.1.2",
              "Caratteristiche di servizio dei binari adibiti al servizio viaggiatori",
              [{ key: "binari_viaggiatori", type: "table", label: "Binari viaggiatori", columns: BINARI_VIAGGIATORI_COLUMNS, addRowLabel: "Aggiungi binario" }]
            ),
            leaf(
              "1.2.1.3",
              "Attrezzature presenti sui binari",
              [{ key: "attrezzature_binari", type: "table", label: "Attrezzature", columns: BINARI_ATTREZZATURE_COLUMNS, addRowLabel: "Aggiungi binario" }]
            ),
          ]),
          leaf(
            "1.2.2",
            "Deviatoi della località di servizio",
            [
              { key: "deviatoi", type: "table", label: "Deviatoi", columns: DEVIATOI_COLUMNS, addRowLabel: "Aggiungi deviatoio" },
              { key: "dislocazione_fermascambi", type: "textarea", label: "Dislocazione dei fermascambi a morsa" },
            ],
            { noPerMemoria: true }
          ),
          leaf(
            "1.2.3",
            "Passaggi a livello",
            [
              { key: "pl_stazione", type: "table", label: "Passaggi a livello di stazione", columns: plColumns(false), addRowLabel: "Aggiungi PL" },
              { key: "pl_linea", type: "table", label: "Passaggi a livello di linea", columns: plColumns(false), addRowLabel: "Aggiungi PL" },
            ]
          ),
          leaf("1.2.4", "Raccordi", [
            { key: "raccordi", type: "table", label: "Raccordi", columns: RACCORDI_COLUMNS, addRowLabel: "Aggiungi raccordo" },
          ]),
          leaf("1.2.5", "Punti singolari della linea"),
          leaf("1.2.6", "Altre caratteristiche infrastrutturali particolari"),
        ]),
      ]),
      group("2", "Attrezzature tecnologiche", [
        group("2.1", "Impianti di sicurezza e di segnalamento", [
          leaf("2.1.1", "Apparato centrale"),
          leaf("2.1.2", "Tabella delle condizioni"),
          leaf("2.1.3", "Movimenti contemporanei dei treni"),
          leaf("2.1.4", "Regimi di esercizio"),
          leaf("2.1.5", "Segnalamento", [
            { key: "segnali", type: "table", label: "Segnali", columns: SEGNALI_COLUMNS, addRowLabel: "Aggiungi segnale" },
            { key: "note_segnalamento", type: "textarea", label: "Note e disposizioni particolari" },
          ]),
        ]),
        leaf("2.2", "Regimi di circolazione dei treni"),
        leaf("2.3", "Ripetizione continua dei segnali in macchina"),
        leaf("2.4", "Protezione dei passaggi a livello", [
          { key: "protezione_pl_stazione", type: "table", label: "PL di stazione", columns: PROTEZIONE_PL_COLUMNS, addRowLabel: "Aggiungi PL" },
          { key: "protezione_pl_linea", type: "table", label: "PL di linea", columns: PROTEZIONE_PL_COLUMNS, addRowLabel: "Aggiungi PL" },
        ]),
        leaf("2.5", "Altre attrezzature di sicurezza e di supporto per la circolazione"),
        group("2.6", "Sistemi informativi, telecomunicazioni e informazioni al pubblico", [
          leaf("2.6.1", "Sistemi informativi"),
          leaf("2.6.2", "Telecomunicazioni"),
          leaf("2.6.3", "Informazioni al pubblico"),
          leaf("2.6.4", "Altre attrezzature tecnologiche particolari"),
        ]),
        leaf("2.7", "Impianto antincendio"),
      ]),
      group("3", "Gestione", [
        group("3.1", "Dirigenza del movimento", [
          leaf("3.1.1", "Esercizio della località di servizio"),
          leaf(
            "3.1.2",
            "Funzioni e attività",
            [attivitaMatrix("attivita_dm", ["DM1", "DM2"], ATTIVITA_DM), { key: "note_funzioni_dm", type: "textarea", label: "Note" }],
            { noPerMemoria: true }
          ),
          group("3.1.3", "Caratteristiche particolari di esercizio della località di servizio", [
            leaf("3.1.3.1", "Norme generali"),
            leaf("3.1.3.2", "Norme specifiche"),
          ]),
        ]),
        group("3.2", "Servizio deviatoi e segnali", [
          leaf("3.2.1", "Organizzazione del servizio dei deviatori"),
          leaf("3.2.2", "Funzioni e attività", [
            attivitaMatrix("attivita_deviatori", ["Deviatore 1", "Deviatore 2"], ATTIVITA_DEVIATORI),
            { key: "note_funzioni_deviatori", type: "textarea", label: "Note" },
          ]),
          leaf("3.2.3", "Particolarità di esercizio del servizio deviatoi e segnali"),
          leaf("3.2.4", "Ulteriori dotazioni"),
        ]),
        group("3.3", "Manovre", [
          leaf("3.3.1", "Manovre programmate"),
          leaf("3.3.2", "Manovre determinate da circostanze occasionali o da situazioni di emergenza"),
        ]),
        leaf("3.4", "Organizzazione del servizio di formazione dei treni"),
      ]),
      group("4", "Misure organizzative e merci pericolose", [
        leaf("4.1", "Misure organizzative e gestionali"),
        leaf("4.2", "Organizzazione del servizio in tempo di neve e gelo"),
        leaf("4.3", "Merci pericolose"),
      ]),
      leaf("5", "Documentazione complementare", [documentazioneField("documentazione")], { noPerMemoria: true }),
      leaf("6", "Aggiornamenti", [aggiornamentiField("aggiornamenti")], { noPerMemoria: true }),
    ];
  }

  function buildStazionePartSeconda() {
    return [
      group("7", "Gestione delle manovre", [
        group("7.1", "Organizzazione del servizio delle manovre", [
          group("7.1.1", "Funzioni delle manovre", [
            leaf("7.1.1.1", "Dirigenza della manovra"),
            leaf("7.1.1.2", "Autorizzazione alla manovra"),
            leaf("7.1.1.3", "Comando della manovra"),
            leaf("7.1.1.4", "Esecuzione della manovra"),
          ]),
          leaf("7.1.2", "Mezzi di trazione impiegati per le manovre"),
          leaf("7.1.3", "Giurisdizione e zone dedicate alle attività di manovra"),
        ]),
        group("7.2", "Particolarità del servizio delle manovre", [
          leaf("7.2.1", "Particolari modalità di esecuzione delle manovre"),
          leaf("7.2.2", "Vincoli nell'esecuzione delle manovre"),
          leaf("7.2.3", "Stazionamento dei veicoli"),
          leaf("7.2.4", "Cautele per l'utilizzazione di determinate attrezzature"),
          leaf("7.2.5", "Merci pericolose"),
        ]),
      ]),
      leaf("8", "Documentazione complementare", [documentazioneField("documentazione2")], { noPerMemoria: true }),
      leaf("9", "Aggiornamenti", [aggiornamentiField("aggiornamenti2")], { noPerMemoria: true }),
    ];
  }

  // ---- Template POSTO DI SERVIZIO (es. DCO) -----------------------------
  const SISTEMI_DEFAULT = [
    "Sistema di Controllo Centralizzato del Traffico (SCCT/DCO)",
    "Rilevamento della temperatura delle boccole e degli assi frenati (RTB/RTF)",
    "Produzione e trasmissione digitale del modulo 0229/2 - Linee interconnesse",
    "Sistema informatizzato per la trasmissione dei dispacci per l'esercizio (SDE)",
    "Sistema di supervisione delle gallerie",
    "Sistema di supervisione antincendio gallerie/stazioni interrate",
    "Consolle telefonica TELEFIN per DCO",
    "Account di posta elettronica aziendale (e-mail)",
    "Esercizio dell'apparato centrale computerizzato multistazione (ACC-M)",
    "Accertamento in remoto dei passaggi a livello",
  ];

  function buildPostoServizioTree() {
    return [
      leaf(
        "1",
        "Caratteristiche infrastrutturali e attrezzature tecnologiche delle tratte di linea",
        [
          {
            key: "rds_periferici",
            type: "table",
            label: "RdS dei posti periferici di giurisdizione (consultabili via RailMobile)",
            columns: RDS_PP_COLUMNS,
            addRowLabel: "Aggiungi posto periferico",
          },
        ],
        { noPerMemoria: true }
      ),
      leaf(
        "2",
        "Attrezzature tecnologiche del posto di servizio",
        [
          {
            key: "sistemi",
            type: "systemlist",
            label: "Sistemi e attrezzature (una voce per sistema; aggiungere una voce per ogni galleria/stazione se necessario per l'impianto antincendio)",
            addRowLabel: "Aggiungi sistema",
            defaultTitles: SISTEMI_DEFAULT,
          },
        ],
        { noPerMemoria: true }
      ),
      group("3", "Gestione delle attività", [
        leaf("3.1", "Compiti"),
        leaf("3.2", "Caratteristiche particolari di esercizio delle località di servizio"),
        group("3.3", "Funzioni", [
          leaf("3.3.1", "DCO Titolare"),
          leaf("3.3.2", "DCO di Sussidio"),
          leaf("3.3.3", "Modulo 0245 (Quadro A/B/C)", [
            { key: "quadro_a", type: "textarea", label: "Quadro A" },
            { key: "quadro_b", type: "textarea", label: "Quadro B" },
            { key: "quadro_c", type: "textarea", label: "Quadro C" },
          ]),
        ]),
      ]),
      leaf("4", "Documentazione complementare", [documentazioneField("documentazione")], { noPerMemoria: true }),
      leaf("5", "Aggiornamenti", [aggiornamentiField("aggiornamenti")], { noPerMemoria: true }),
    ];
  }

  const TEMPLATES = {
    stazione: {
      id: "stazione",
      label: "Stazione / Posto di comunicazione / Bivio",
      hasPartSeconda: true,
      metaFields: metaFields("stazione"),
      parteUno: buildStazioneTree(),
      parteDue: buildStazionePartSeconda(),
    },
    posto_servizio: {
      id: "posto_servizio",
      label: "Posto di servizio (es. DCO)",
      hasPartSeconda: false,
      metaFields: metaFields("posto_servizio"),
      parteUno: buildPostoServizioTree(),
      parteDue: null,
    },
  };

  global.RDS = global.RDS || {};
  global.RDS.TEMPLATES = TEMPLATES;
  global.RDS.SI_NO = SI_NO;
})(window);

/* Rilievi di bordo — Rete FERROVIENORD
 *
 * L'app copre più percorsi (rami Iseo e Milano): il manutentore ne sceglie
 * uno all'avvio, e può cambiarlo in corsa dal riquadro "Aggancio manuale" nei
 * punti dove la linea si dirama (es. Saronno). Ogni percorso ha una propria
 * progressiva chilometrica, non necessariamente a partire da zero (vedi
 * S.kmMin/S.kmMax) — motivo per cui i limiti non sono mai scritti come 0 nel
 * codice sottostante, ma sempre relativi al percorso attivo.
 *
 * Calcolo della progressiva, per odometria ancorata:
 *   - passando accanto a un cippo chilometrico censito il km viene riportato al
 *     suo valore esatto (un cippo ogni chilometro, quindi un aggancio ogni ~45 s
 *     a 80 km/h);
 *   - fra un cippo e l'altro il km avanza integrando la velocità restituita dal
 *     GPS, che misura i metri realmente percorsi sul binario, curve comprese.
 * La deriva fra due agganci è di pochi metri. La proiezione della posizione
 * sulla spezzata dei cippi resta come riferimento assoluto, ma solo per
 * ritrovarsi dopo un buio GPS prolungato.
 */
(() => {
  'use strict';

  // ------------------------------- costanti -------------------------------

  const CHIAVE_RILIEVI  = 'bordo.rilievi.v1';
  const CHIAVE_SESSIONE = 'bordo.sessione.v1';

  const SOGLIA_PERCORSO_SBAGLIATO = 3000;  // m dalla polilinea oltre cui il percorso scelto è verosimilmente quello sbagliato
  const CONFERME_PERCORSO_SBAGLIATO = 3;   // fix consecutivi lontani, prima di avvisare (un singolo fix può essere un abbaglio)

  const RAGGIO_AGGANCIO = 300;   // m — entro cui una località è candidata all'aggancio
  const USCITA_AGGANCIO = 420;   // m — oltre cui l'aggancio viene chiuso
  const RISALITA_MINIMA = 30;    // m — risalita dopo il minimo che conferma il transito
  const VELOCITA_FERMO  = 1.5;   // m/s sotto cui il treno è considerato fermo
  const FERMO_MIN_MS    = 4000;  // ms di sosta che confermano l'arrivo in località
  const RAGGIO_SOSTA    = 250;   // m — entro cui una sosta vale come fermata in località
  const BUFFER_SEC      = 180;   // s di posizioni tenute per la correzione all'indietro
  const TRACCIA_PASSO   = 2000;  // ms fra due punti di traccia salvati
  const DR_SOGLIA_SEC   = 3;     // s senza fix oltre cui si passa alla stima
  const SCARTO_ALLARME  = 400;   // m di correzione oltre cui si avvisa l'operatore

  /* Limiti della navigazione stimata (senza GPS). La sezione 26 del Fascicolo
   * elenca le gallerie oltre i mille metri: sulla Brescia - Iseo - Edolo non ce
   * n'è nessuna, quindi il buio dura al massimo qualche decina di secondi.
   * Oltre questi limiti è più onesto fermare la progressiva che inventarla. */
  const DR_MAX_SEC      = 90;    // s massimi di stima senza fix
  const DR_MAX_METRI    = 2500;  // m massimi percorsi in stima

  const TIPI_LOCALITA = ['capotronco', 'stazione', 'fermata'];

  /* Riferimenti che si vedono davvero dal finestrino: PL, deviatoi, segnali.
   * Un punto di variazione della velocità non aiuta a localizzare un guasto. */
  const TIPI_RIFERIMENTO = ['pla', 'deviatoio', 'segnale'];

  // -------------------------------- stato ---------------------------------

  const S = {
    rete: null,           // { meta, percorsi: [...] }, l'intero rete.json
    percorso: null,       // il percorso attualmente selezionato
    punti: [],
    localita: [],        // stazioni, fermate, capotronco
    cippi: [],           // cippi chilometrici georeferenziati
    polilinea: [],       // geometria della linea usata per le proiezioni
    kmMin: 0,            // estremi del percorso attivo (non sempre 0..lunghezza)
    kmMax: 0,
    sosta: null,         // fermata in località in corso
    rilievi: [],
    attivo: false,
    km: null,
    verso: 1,            // +1 verso l'estremo di km maggiore, -1 verso l'altro
    tRef: null,          // istante fino a cui il km è integrato
    ultimaVel: 0,
    ultimoFix: null,
    qualita: 'assente',
    buffer: [],
    candidato: null,
    ancora: null,        // { nome, km, t }
    scarto: null,        // ultima correzione applicata, in metri
    drMetri: 0,          // metri percorsi in navigazione stimata dall'ultimo fix
    velocitaSospetta: false,
    progressivaPersa: false,  // la stima è stata troncata: serve una ricollocazione
    stimata: false,           // km ricostruito dalla posizione, non ancora agganciato
    fuoriRotta: 0,            // fix consecutivi incoerenti con la progressiva
    fuoriPercorso: false,     // il GPS è lontano dal percorso scelto: probabile errore di selezione
    fuoriPercorsoContatore: 0,
    distanzaPercorsoM: null,  // ultima distanza nota dalla polilinea del percorso attivo
    watchId: null,
    wakeLock: null,
    tickId: null,
    traccia: { ultimo: 0, conta: 0 },
    bozza: null,
    correzioneSec: 0,
    filtroLinea: 'tutti'
  };

  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ------------------------------ utilità ---------------------------------

  const limita = (v, min, max) => Math.min(max, Math.max(min, v));

  function distanza(lat1, lon1, lat2, lon2) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** "47+382" a partire da 47.3821 */
  function formattaKm(km) {
    if (km == null || !isFinite(km)) return '—';
    let intero = Math.floor(km);
    let metri = Math.round((km - intero) * 1000);
    if (metri >= 1000) { intero += 1; metri -= 1000; }
    return intero + '+' + String(metri).padStart(3, '0');
  }

  function cippoDi(km) {
    if (km == null || !isFinite(km)) return null;
    const intero = Math.floor(km);
    const metri = Math.round((km - intero) * 1000);
    return metri >= 1000 ? intero + 1 : intero;
  }

  /** 102.709 → "102,709" */
  const kmDecimale = (km) => (km == null ? '—' : km.toFixed(3).replace('.', ','));

  const metriTesto = (m) => (m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km'
                                       : Math.round(m) + ' m');

  function oraLocale(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function nomeFile(estensione) {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `rilievi-FN-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
           `-${p(d.getHours())}${p(d.getMinutes())}.${estensione}`;
  }

  const escXml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  const escHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  let timerNotifica = null;
  function notifica(testo) {
    const el = $('#notifica');
    el.textContent = testo;
    el.hidden = false;
    clearTimeout(timerNotifica);
    timerNotifica = setTimeout(() => { el.hidden = true; }, 3200);
  }

  // --------------------------- archivio locale ----------------------------

  function caricaRilievi() {
    try {
      const g = localStorage.getItem(CHIAVE_RILIEVI);
      S.rilievi = g ? JSON.parse(g) : [];
    } catch { S.rilievi = []; }
    if (!Array.isArray(S.rilievi)) S.rilievi = [];
  }

  function salvaRilievi() {
    try {
      localStorage.setItem(CHIAVE_RILIEVI, JSON.stringify(S.rilievi));
    } catch {
      notifica('Memoria del telefono piena: esporta e svuota i rilievi.');
    }
  }

  function salvaSessione() {
    try {
      localStorage.setItem(CHIAVE_SESSIONE, JSON.stringify({
        percorsoId: S.percorso ? S.percorso.id : null,
        km: S.km, verso: S.verso, ancora: S.ancora, t: Date.now()
      }));
    } catch { /* non essenziale */ }
  }

  function leggiSessione() {
    try {
      const g = JSON.parse(localStorage.getItem(CHIAVE_SESSIONE) || 'null');
      // una sessione più vecchia di 6 ore non è più attendibile
      if (g && Date.now() - g.t < 6 * 3600 * 1000) return g;
    } catch { /* ignora */ }
    return null;
  }

  // ----------------------- traccia GPS (IndexedDB) ------------------------

  let dbPromessa = null;
  function db() {
    if (!dbPromessa) {
      dbPromessa = new Promise((risolvi, rifiuta) => {
        if (!('indexedDB' in window)) return rifiuta(new Error('IndexedDB non disponibile'));
        const r = indexedDB.open('bordo-treno', 1);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains('traccia')) {
            r.result.createObjectStore('traccia', { keyPath: 'id', autoIncrement: true });
          }
        };
        r.onsuccess = () => risolvi(r.result);
        r.onerror = () => rifiuta(r.error);
      });
    }
    return dbPromessa;
  }

  async function tracciaAggiungi(p) {
    try {
      const d = await db();
      await new Promise((ok, no) => {
        const tx = d.transaction('traccia', 'readwrite');
        tx.objectStore('traccia').add(p);
        tx.oncomplete = ok; tx.onerror = () => no(tx.error);
      });
      S.traccia.conta += 1;
      const el = $('#st-traccia');
      if (el) el.textContent = S.traccia.conta.toLocaleString('it-IT');
    } catch { /* la traccia è accessoria: non deve mai bloccare il rilievo */ }
  }

  async function tracciaConta() {
    try {
      const d = await db();
      return await new Promise((ok, no) => {
        const r = d.transaction('traccia', 'readonly').objectStore('traccia').count();
        r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
      });
    } catch { return 0; }
  }

  async function tracciaLeggi() {
    try {
      const d = await db();
      return await new Promise((ok, no) => {
        const r = d.transaction('traccia', 'readonly').objectStore('traccia').getAll();
        r.onsuccess = () => ok(r.result || []); r.onerror = () => no(r.error);
      });
    } catch { return []; }
  }

  async function tracciaSvuota() {
    try {
      const d = await db();
      await new Promise((ok, no) => {
        const tx = d.transaction('traccia', 'readwrite');
        tx.objectStore('traccia').clear();
        tx.oncomplete = ok; tx.onerror = () => no(tx.error);
      });
      S.traccia.conta = 0;
      $('#st-traccia').textContent = '0';
    } catch { /* ignora */ }
  }

  // --------------------------- dati della rete -----------------------------

  async function caricaRete() {
    const r = await fetch('dati/rete.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('rete.json non raggiungibile');
    S.rete = await r.json();
    S.rete.percorsi.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  }

  const trovaPercorso = (id) => S.rete.percorsi.find((p) => p.id === id) || null;

  /** Attiva un percorso: ricalcola tutte le strutture derivate che il motore
   *  di posizione usa. Non tocca km/verso/ancora — quello lo fa chi chiama
   *  (avvio da zero, o cambio percorso a treno in corsa). */
  function selezionaPercorso(percorso) {
    S.percorso = percorso;
    S.punti = percorso.punti.slice().sort((a, b) => a.km - b.km);
    S.localita = S.punti.filter((p) => TIPI_LOCALITA.includes(p.tipo));
    S.cippi = S.punti.filter((p) => p.tipo === 'cippo' && p.lat != null);

    const kmDeiPunti = S.punti.map((p) => p.km);
    S.kmMin = Math.min(...kmDeiPunti);
    S.kmMax = Math.max(...kmDeiPunti);

    /* Spina dorsale geometrica della linea. I cippi sono censiti ogni
     * chilometro e rilevati sul posto: sono molto più fitti e più affidabili
     * delle località, le cui coordinate vengono da un export schematico. */
    S.polilinea = S.cippi.length >= 2
      ? S.cippi
      : S.localita.filter((p) => p.lat != null && p.coordAffidabile !== false);
  }

  const lunghezza = () => (S.percorso ? S.kmMax - S.kmMin : 0);

  /** Punti a km noto e coordinata attendibile, usati per riagganciare. */
  const puntiAggancio = () =>
    (S.cippi.length >= 2
      ? S.cippi
      : S.localita.filter((p) => p.lat != null && p.coordAffidabile !== false));

  const localitaAgganciabili = () =>
    S.localita.filter((p) => p.lat != null && p.coordAffidabile !== false);

  function contesto(km) {
    let prec = null, succ = null;
    for (const p of S.localita) {
      if (p.km <= km + 1e-9) prec = p;
      else { succ = p; break; }
    }
    return { prec, succ };
  }

  /** Punto notevole (PL, deviatoio, segnale) più vicino entro `raggioM`. */
  function notevoleVicino(km, raggioM = 600) {
    let scelto = null, minimo = Infinity;
    for (const p of S.punti) {
      if (!TIPI_RIFERIMENTO.includes(p.tipo)) continue;
      const d = Math.abs(p.km - km) * 1000;
      if (d < minimo) { minimo = d; scelto = p; }
    }
    return (scelto && minimo <= raggioM) ? { punto: scelto, dist: minimo } : null;
  }

  // ------------------------- motore di posizione --------------------------

  /** Integra il km fino all'istante `t` usando la velocità `v` (m/s). */
  function avanza(t, v) {
    if (!isFinite(v) || v < 0) v = 0;
    if (S.tRef == null) { S.tRef = t; S.ultimaVel = v; return; }
    let dt = (t - S.tRef) / 1000;
    if (dt <= 0) { S.ultimaVel = v; return; }
    if (dt > 30) dt = 30;                      // dopo una sospensione non inventiamo strada
    const media = (S.ultimaVel + v) / 2;
    S.km = limita(S.km + S.verso * media * dt / 1000, S.kmMin, S.kmMax);
    S.tRef = t;
    S.ultimaVel = v;
  }

  function memorizza(t, lat, lon, acc, v) {
    S.buffer.push({ t, km: S.km, lat, lon, acc, v });
    const taglio = t - BUFFER_SEC * 1000;
    while (S.buffer.length && S.buffer[0].t < taglio) S.buffer.shift();
  }

  /* Il traverso del cippo cade quasi sempre FRA due fix GPS: prendere il
   * campione più vicino quantizzerebbe l'aggancio alla distanza fra due fix
   * (11 m a 80 km/h, molto di più in accelerazione). Attorno al minimo la
   * distanza al quadrato varia come una parabola: se ne cerca il vertice sui
   * tre campioni centrali e si ottiene il traverso con precisione di pochi metri. */
  function kmAlTraverso(storia) {
    if (!storia.length) return null;
    let i = 0;
    for (let k = 1; k < storia.length; k++) if (storia[k].d < storia[i].d) i = k;
    if (i === 0 || i === storia.length - 1) return storia[i].km;

    const x1 = storia[i - 1].km, y1 = storia[i - 1].d ** 2;
    const x2 = storia[i].km,     y2 = storia[i].d ** 2;
    const x3 = storia[i + 1].km, y3 = storia[i + 1].d ** 2;

    const den = (x1 - x2) * (x1 - x3) * (x2 - x3);
    if (Math.abs(den) < 1e-12) return x2;
    const a = (x3 * (y2 - y1) + x2 * (y1 - y3) + x1 * (y3 - y2)) / den;
    const b = (x3 * x3 * (y1 - y2) + x2 * x2 * (y3 - y1) + x1 * x1 * (y2 - y3)) / den;
    if (a <= 0) return x2;                     // non è un minimo: meglio il campione

    const vertice = -b / (2 * a);
    return (vertice > x1 && vertice < x3) ? vertice : x2;
  }

  /* Riaggancio al transito: si passa accanto a un cippo, la distanza tocca il
   * minimo e riprende a crescere. Quel minimo è il momento in cui il treno è
   * al traverso del cippo, cioè esattamente al suo chilometro. */
  function verificaAggancio(t, lat, lon, v) {
    const candidati = puntiAggancio();
    if (candidati.length) {
      let vicino = null, dmin = Infinity;
      for (const p of candidati) {
        const d = distanza(lat, lon, p.lat, p.lon);
        if (d < dmin) { dmin = d; vicino = p; }
      }

      if (dmin > RAGGIO_AGGANCIO) {
        // usciti dal raggio senza aver agganciato: si aggancia ora, sul minimo visto
        if (S.candidato && dmin > USCITA_AGGANCIO) {
          if (!S.candidato.fatto) {
            applicaAggancioSuPunto(S.candidato.punto, kmAlTraverso(S.candidato.storia), t);
          }
          S.candidato = null;
        }
      } else if (!S.candidato || S.candidato.punto !== vicino) {
        S.candidato = { punto: vicino, dmin, t, fatto: false, storia: [{ km: S.km, d: dmin }] };
      } else {
        S.candidato.storia.push({ km: S.km, d: dmin });
        if (S.candidato.storia.length > 120) S.candidato.storia.shift();
        if (dmin < S.candidato.dmin) { S.candidato.dmin = dmin; S.candidato.t = t; }

        if (!S.candidato.fatto && dmin > S.candidato.dmin + RISALITA_MINIMA) {
          S.candidato.fatto = true;
          applicaAggancioSuPunto(S.candidato.punto, kmAlTraverso(S.candidato.storia), t);
        }
      }
    }

    verificaSosta(t, lat, lon, v);
  }

  /* Rete di sicurezza: il treno fermo in località. Va cercata SOLO fra le
   * località, mai fra i cippi — fermarsi a Iseo (km 25,713) significa trovarsi
   * a 287 m dal cippo 26, e agganciare lì introdurrebbe quell'errore.
   * Con i cippi disponibili è comunque il riferimento peggiore, perché le
   * coordinate delle località vengono da un export schematico: interviene solo
   * se da oltre 3 km non si aggancia più nulla. */
  function verificaSosta(t, lat, lon, v) {
    if (v >= VELOCITA_FERMO) { S.sosta = null; return; }
    if (S.cippi.length >= 2 && S.ancora && Math.abs(S.km - S.ancora.km) < 3) return;

    let vicina = null, dmin = Infinity;
    for (const p of localitaAgganciabili()) {
      const d = distanza(lat, lon, p.lat, p.lon);
      if (d < dmin) { dmin = d; vicina = p; }
    }
    if (!vicina || dmin > RAGGIO_SOSTA) { S.sosta = null; return; }

    if (!S.sosta || S.sosta.punto !== vicina) { S.sosta = { punto: vicina, da: t, fatto: false }; return; }
    if (S.sosta.fatto) return;
    if (t - S.sosta.da >= FERMO_MIN_MS) {
      S.sosta.fatto = true;
      applicaAggancioSuPunto(vicina, S.km, t);   // siamo lì adesso
    }
  }

  function applicaAggancioSuPunto(punto, kmMisurato, t) {
    if (kmMisurato == null || !isFinite(kmMisurato)) return;
    const delta = punto.km - kmMisurato;       // in km
    const precedente = S.ancora;

    S.km = limita(S.km + delta, S.kmMin, S.kmMax);
    S.ancora = { nome: punto.nome, km: punto.km, t };
    S.scarto = delta * 1000;
    S.stimata = false;                         // da qui il km torna quello ufficiale
    S.progressivaPersa = false;
    S.fuoriRotta = 0;

    // la direzione si deduce dall'ordine dei due ultimi agganci
    if (precedente && precedente.km !== punto.km) {
      S.verso = punto.km > precedente.km ? 1 : -1;
    }

    if (Math.abs(S.scarto) >= SCARTO_ALLARME) {
      notifica(`Riallineato su ${punto.nome}: correzione di ${Math.round(S.scarto)} m.`);
    }
    salvaSessione();
    disegnaAvviso();
  }

  /** Aggancio manuale sulla località scelta. Se `percorso` è diverso da
   *  quello attivo (bivio superato, es. a Saronno), cambia anche quello: le
   *  due scale di km non sono confrontabili fra loro, quindi in quel caso il
   *  verso di marcia va lasciato come sta invece di dedurlo dall'ancora
   *  precedente — la potrà correggere l'operatore al prossimo aggancio. */
  function agganciaManuale(percorso, punto) {
    const cambioPercorso = !S.percorso || percorso.id !== S.percorso.id;
    const precedente = S.ancora;
    if (cambioPercorso) selezionaPercorso(percorso);

    S.km = punto.km;
    S.ancora = { nome: punto.nome, km: punto.km, t: Date.now() };
    S.candidato = null;
    S.sosta = null;
    S.scarto = null;
    S.stimata = false;
    S.progressivaPersa = false;
    S.fuoriRotta = 0;
    S.fuoriPercorso = false;
    S.fuoriPercorsoContatore = 0;
    if (!cambioPercorso && precedente && precedente.km !== punto.km) {
      S.verso = punto.km > precedente.km ? 1 : -1;
    }

    if (cambioPercorso) { disegnaFonti(); disegnaLinea(); }
    salvaSessione();
    disegna();
    notifica(cambioPercorso
      ? `Percorso cambiato: ${percorso.nome}. Agganciato a ${punto.nome} — km ${kmDecimale(punto.km)}`
      : `Agganciato a ${punto.nome} — km ${kmDecimale(punto.km)}`);
  }

  function qualitaDa(acc) {
    if (acc == null || !isFinite(acc)) return 'buona';
    if (acc <= 15) return 'ottima';
    if (acc <= 40) return 'buona';
    return 'scarsa';
  }

  /* Stima della progressiva dalla sola posizione, proiettandola sulla spezzata
   * della linea. È un riferimento ASSOLUTO: serve a ritrovarsi dopo un lungo
   * buio GPS, non a sostituire l'aggancio. Con i cippi la spezzata ha un
   * vertice ogni chilometro, quindi il taglio delle curve pesa poco. */
  function stimaKmDaPosizione(lat, lon) {
    const L = S.polilinea;
    if (L.length < 2) return null;
    const r = Math.PI / 180, R = 6371000, cos0 = Math.cos(lat * r);
    // sistema metrico locale con il punto GPS nell'origine
    const xy = (la, lo) => [R * (lo - lon) * r * cos0, R * (la - lat) * r];

    let migliore = null;
    for (let i = 0; i < L.length - 1; i++) {
      const [ax, ay] = xy(L[i].lat, L[i].lon);
      const [bx, by] = xy(L[i + 1].lat, L[i + 1].lon);
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const f = limita(-(ax * dx + ay * dy) / len2, 0, 1);
      const d = Math.hypot(ax + f * dx, ay + f * dy);
      if (!migliore || d < migliore.d) {
        migliore = { d, km: L[i].km + f * (L[i + 1].km - L[i].km) };
      }
    }
    return migliore;
  }

  /* Il caso pericoloso: il treno supera una località mentre il GPS tace, quindi
   * nessun aggancio scatta, e al ritorno del segnale l'app mostrerebbe una
   * pastiglia verde sopra una progressiva sbagliata di oltre un chilometro. */
  function ricollocaSeNecessario(stima) {
    if (!stima || stima.d > 1500) return;    // troppo lontano dalla linea per fidarsi

    if (S.progressivaPersa) {
      S.km = stima.km;
      S.progressivaPersa = false;
      S.fuoriRotta = 0;
      S.stimata = true;
      notifica(`Posizione ritrovata: km ${formattaKm(S.km)}, stimata fino alla prossima località.`);
      return;
    }

    if (Math.abs(stima.km - S.km) * 1000 > 1500) {
      S.fuoriRotta += 1;                     // un solo fix può essere un abbaglio
      if (S.fuoriRotta >= 5) {
        S.km = stima.km;
        S.fuoriRotta = 0;
        S.stimata = true;
        notifica(`Progressiva incoerente con il GPS: riportata a km ${formattaKm(S.km)}.`);
      }
    } else {
      S.fuoriRotta = 0;
    }
  }

  /* Il caso opposto di ricollocaSeNecessario: qui il GPS non è "un po' incoerente
   * col km", è a chilometri di distanza dall'INTERO percorso scelto — quasi
   * certamente perché il manutentore ha selezionato la linea sbagliata (es.
   * selezionata "Busto Arsizio Nord - Malpensa" mentre il treno è a Iseo).
   * Nessun tentativo di correggere da sola: solo un avviso esplicito, perché
   * qui la stima sulla polilinea del percorso sbagliato non ha alcun senso e
   * andrebbe ignorata, non usata per "aggiustare" il km. */
  function verificaPercorsoPlausibile(stima) {
    if (!stima) return;
    S.distanzaPercorsoM = stima.d;
    if (stima.d <= SOGLIA_PERCORSO_SBAGLIATO) {
      S.fuoriPercorsoContatore = 0;
      S.fuoriPercorso = false;
      return;
    }
    S.fuoriPercorsoContatore += 1;
    if (S.fuoriPercorsoContatore >= CONFERME_PERCORSO_SBAGLIATO) S.fuoriPercorso = true;
  }

  /* L'odometria si regge sulla velocità dichiarata dal GPS. Alcuni dispositivi
   * la riportano sbagliata (o fantasma a veicolo fermo): confrontiamo allora la
   * strada integrata con lo spostamento effettivamente osservato. Anche sulla
   * tratta più tortuosa della linea la corda vale il 77% del binario, quindi
   * sotto il 40% la velocità dichiarata non è credibile. */
  function velocitaCoerente(t, lat, lon) {
    let vecchio = null;
    for (const b of S.buffer) { if (t - b.t <= 30000) { vecchio = b; break; } }
    if (!vecchio || t - vecchio.t < 15000) return true;
    const odometria = Math.abs(S.km - vecchio.km) * 1000;
    if (odometria < 300) return true;
    return distanza(lat, lon, vecchio.lat, vecchio.lon) >= 0.4 * odometria;
  }

  function suFix(pos) {
    const c = pos.coords;
    const t = pos.timestamp || Date.now();

    let daPosizioni = null;
    if (S.ultimoFix) {
      const dt = (t - S.ultimoFix.t) / 1000;
      if (dt > 0) {
        const d = distanza(S.ultimoFix.lat, S.ultimoFix.lon, c.latitude, c.longitude);
        daPosizioni = d < 3 ? 0 : d / dt;      // sotto i 3 m è rumore, non moto
      }
    }
    const daGps = (c.speed != null && isFinite(c.speed) && c.speed >= 0) ? c.speed : null;

    let v = S.velocitaSospetta ? daPosizioni : (daGps != null ? daGps : daPosizioni);
    if (v == null) v = S.ultimaVel;

    avanza(t, v);
    const stima = stimaKmDaPosizione(c.latitude, c.longitude);
    ricollocaSeNecessario(stima);
    verificaPercorsoPlausibile(stima);
    memorizza(t, c.latitude, c.longitude, c.accuracy, v);

    if (!S.velocitaSospetta && daGps != null && !velocitaCoerente(t, c.latitude, c.longitude)) {
      S.velocitaSospetta = true;
      notifica('Velocità GPS incoerente con lo spostamento: passo al calcolo sulle posizioni.');
    }

    verificaAggancio(t, c.latitude, c.longitude, v);

    S.ultimoFix = { t, lat: c.latitude, lon: c.longitude, acc: c.accuracy, v };
    S.qualita = qualitaDa(c.accuracy);
    S.drMetri = 0;                             // il GPS è tornato: la stima riparte da zero

    if (t - S.traccia.ultimo >= TRACCIA_PASSO) {
      S.traccia.ultimo = t;
      tracciaAggiungi({
        t, lat: +c.latitude.toFixed(6), lon: +c.longitude.toFixed(6),
        acc: c.accuracy == null ? null : Math.round(c.accuracy),
        v: +v.toFixed(2), km: S.km == null ? null : +S.km.toFixed(4),
        percorsoId: S.percorso ? S.percorso.id : null
      });
    }

    disegna();
  }

  function suErroreGps(err) {
    if (err.code === err.PERMISSION_DENIED) {
      S.qualita = 'assente';
      notifica('Permesso di localizzazione negato: l\'app non può calcolare il km.');
      disegna();
    }
  }

  /** Navigazione stimata quando il GPS tace (gallerie). */
  function tick() {
    if (!S.attivo) return;
    const ora = Date.now();
    const silenzio = S.ultimoFix ? (ora - S.ultimoFix.t) / 1000 : Infinity;

    if (silenzio > DR_SOGLIA_SEC && S.ultimoFix) {
      if (silenzio <= DR_MAX_SEC && S.drMetri < DR_MAX_METRI) {
        const prima = S.km;
        avanza(ora, S.ultimaVel);
        S.drMetri += Math.abs(S.km - prima) * 1000;
        memorizza(ora, S.ultimoFix.lat, S.ultimoFix.lon, null, S.ultimaVel);
        S.qualita = 'stimata';
      } else {
        // oltre i limiti si preferisce una progressiva ferma a una inventata
        S.ultimaVel = 0;
        S.tRef = ora;
        S.qualita = 'assente';
        S.progressivaPersa = true;   // al ritorno del GPS va ricollocata, non ripresa
      }
      disegna();
    }
    salvaSessione();
  }

  // ----------------------------- avvio / stop -----------------------------

  async function avvia(percorso, puntoPartenza, verso) {
    if (!('geolocation' in navigator)) {
      notifica('Questo dispositivo non espone il GPS al browser.');
      return;
    }

    selezionaPercorso(percorso);
    S.km = puntoPartenza.km;
    S.verso = verso;
    S.ancora = { nome: puntoPartenza.nome, km: puntoPartenza.km, t: Date.now() };
    S.tRef = null;
    S.ultimaVel = 0;
    S.ultimoFix = null;
    S.buffer = [];
    S.candidato = null;
    S.sosta = null;
    S.scarto = null;
    S.drMetri = 0;
    S.velocitaSospetta = false;
    S.progressivaPersa = false;
    S.stimata = false;
    S.fuoriRotta = 0;
    S.fuoriPercorso = false;
    S.fuoriPercorsoContatore = 0;
    S.distanzaPercorsoM = null;
    S.attivo = true;

    S.watchId = navigator.geolocation.watchPosition(suFix, suErroreGps, {
      enableHighAccuracy: true, maximumAge: 0, timeout: 20000
    });
    S.tickId = setInterval(tick, 1000);

    try {
      if ('wakeLock' in navigator) S.wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* niente wake lock: pazienza */ }

    $('#avvio').hidden = true;
    $('#pannello').hidden = false;
    $('#sel-percorso-cambio').value = S.percorso.id;
    $('#sel-aggancio').innerHTML = opzioniLocalita(S.percorso);
    disegnaFonti();
    disegnaLinea();
    salvaSessione();
    disegna();
  }

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && S.attivo && 'wakeLock' in navigator && !S.wakeLock) {
      try { S.wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ignora */ }
    }
  });

  // ------------------------------ interfaccia -----------------------------

  const ETICHETTE_QUALITA = {
    ottima: 'GPS ottimo', buona: 'GPS buono', scarsa: 'GPS impreciso',
    stimata: 'posizione stimata', assente: 'GPS assente',
    ricostruita: 'progressiva ricostruita da GPS, non agganciata'
  };

  function disegna() {
    const pill = $('#pill-gps');
    pill.className = 'pill pill-' + S.qualita;
    let testo = ETICHETTE_QUALITA[S.qualita];
    if (S.ultimoFix && S.ultimoFix.acc != null && (S.qualita === 'ottima' || S.qualita === 'buona' || S.qualita === 'scarsa')) {
      testo += ` ±${Math.round(S.ultimoFix.acc)} m`;
    }
    $('#pill-gps-testo').textContent = testo;

    if (S.percorso) $('#testata-titolo').textContent = S.percorso.nome;

    if (S.attivo && S.localita.length) {
      const basso = S.localita[0], alto = S.localita[S.localita.length - 1];
      $('#etichetta-verso').textContent = `marcia verso ${S.verso > 0 ? alto.nome : basso.nome}`;
      $('#km-estremo-basso').textContent = `${basso.nome} ${kmDecimale(basso.km)}`;
      $('#km-estremo-alto').textContent = `${alto.nome} ${kmDecimale(alto.km)}`;
    } else {
      $('#etichetta-verso').textContent = 'rilevamento non avviato';
    }

    if (!S.attivo || S.km == null) return;

    const grande = $('#km-grande');
    grande.textContent = formattaKm(S.km);
    grande.classList.toggle('stimato',
      S.qualita === 'stimata' || S.qualita === 'assente' || S.stimata);

    const cippo = cippoDi(S.km);
    const metriDalCippo = Math.round((S.km - Math.floor(S.km)) * 1000);
    const alProssimo = 1000 - metriDalCippo;
    $('#km-cippo').textContent =
      `cippo ${cippo} · ${metriDalCippo} m oltre · prossimo cippo fra ${alProssimo} m`;

    $('#km-avanzamento').style.width = ((S.km - S.kmMin) / lunghezza() * 100).toFixed(2) + '%';

    const { prec, succ } = contesto(S.km);
    $('#st-tratta').textContent = prec && succ ? `${prec.nome} → ${succ.nome}`
                                : prec ? prec.nome : '—';
    $('#st-prossima').textContent = (S.verso > 0 ? succ : prec)
      ? `${(S.verso > 0 ? succ : prec).nome} · ${metriTesto(Math.abs((S.verso > 0 ? succ : prec).km - S.km) * 1000)}`
      : 'capolinea';

    $('#st-velocita').textContent = (S.ultimaVel * 3.6).toFixed(0) + ' km/h';
    $('#st-ancora').textContent = S.ancora
      ? `${S.ancora.nome} · ${metriTesto(Math.abs(S.km - S.ancora.km) * 1000)} fa`
      : '—';

    $('#btn-registra').disabled = false;
    disegnaAvviso();
  }

  function disegnaAvviso() {
    const el = $('#avviso-deriva');
    if (!S.attivo) { el.hidden = true; return; }

    /* Priorità massima: se il GPS è a chilometri dall'intero percorso scelto,
     * nessun altro avviso ha senso — il numero a schermo non c'entra nulla
     * con dove sei davvero. Va segnalato in modo inequivocabile, non con la
     * stessa formula usata per una semplice deriva sul percorso giusto. */
    if (S.fuoriPercorso) {
      el.hidden = false;
      el.classList.add('avviso-grave');
      const km = S.distanzaPercorsoM != null ? metriTesto(S.distanzaPercorsoM) : 'più chilometri';
      el.textContent = `Il GPS è a ${km} dal percorso "${S.percorso.nome}": molto probabilmente ` +
                       `hai selezionato il percorso sbagliato. Fermati e correggi da "Aggancio manuale", ` +
                       `oppure riavvia scegliendo il percorso giusto.`;
      return;
    }
    el.classList.remove('avviso-grave');

    if (S.qualita === 'assente' && S.ultimoFix) {
      el.hidden = false;
      el.textContent = 'GPS assente da troppo tempo: la progressiva è ferma e non è più ' +
                       'attendibile. Riaggancia a mano appena riconosci una località.';
      return;
    }
    if (S.qualita === 'stimata') {
      el.hidden = false;
      const secondi = Math.round((Date.now() - S.ultimoFix.t) / 1000);
      el.textContent = `Nessun segnale GPS da ${secondi} s (galleria?): la progressiva ` +
                       `prosegue stimata sull'ultima velocità, ${Math.round(S.drMetri)} m finora.`;
      return;
    }
    if (S.stimata) {
      el.hidden = false;
      el.textContent = 'Progressiva ricostruita dalla posizione GPS, non agganciata a una ' +
                       'località: può sbagliare di qualche centinaio di metri. Torna esatta ' +
                       'al prossimo passaggio in località.';
      return;
    }
    if (S.scarto != null && Math.abs(S.scarto) >= SCARTO_ALLARME && S.ancora) {
      el.hidden = false;
      el.textContent = `Ultimo aggancio su ${S.ancora.nome}: correzione di ` +
                       `${Math.round(S.scarto)} m. Controlla i rilievi presi prima.`;
      return;
    }
    el.hidden = true;
  }

  // ------------------------- registrazione punto --------------------------

  function campioneIndietro(secondi) {
    if (!secondi) return null;
    const bersaglio = Date.now() - secondi * 1000;
    let scelto = null, minimo = Infinity;
    for (const b of S.buffer) {
      const d = Math.abs(b.t - bersaglio);
      if (d < minimo) { minimo = d; scelto = b; }
    }
    // se il buffer non arriva abbastanza indietro, meglio dirlo che mentire
    return (scelto && minimo <= 4000) ? scelto : null;
  }

  function componiBozza(secondiIndietro) {
    const base = campioneIndietro(secondiIndietro);
    const km   = base ? base.km : S.km;
    const lat  = base ? base.lat : (S.ultimoFix ? S.ultimoFix.lat : null);
    const lon  = base ? base.lon : (S.ultimoFix ? S.ultimoFix.lon : null);
    const acc  = base ? base.acc : (S.ultimoFix ? S.ultimoFix.acc : null);
    const vel  = base ? base.v : S.ultimaVel;

    const { prec, succ } = contesto(km);
    const vicino = notevoleVicino(km);

    return {
      id: S.bozza ? S.bozza.id : ('r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      ts: S.bozza ? S.bozza.ts : Date.now(),
      percorsoId: S.bozza ? S.bozza.percorsoId : (S.percorso ? S.percorso.id : null),
      percorsoNome: S.bozza ? S.bozza.percorsoNome : (S.percorso ? S.percorso.nome : ''),
      km: +km.toFixed(4),
      cippo: cippoDi(km),
      metriDalCippo: Math.round((km - Math.floor(km)) * 1000),
      lat: lat == null ? null : +lat.toFixed(6),
      lon: lon == null ? null : +lon.toFixed(6),
      precisioneM: acc == null ? null : Math.round(acc),
      velocitaKmh: +(vel * 3.6).toFixed(1),
      correzioneSec: secondiIndietro || 0,
      correzioneApplicata: !!base,
      precedente: prec ? { nome: prec.nome, km: prec.km } : null,
      successiva: succ ? { nome: succ.nome, km: succ.km } : null,
      vicino: vicino ? { nome: vicino.punto.nome, tipo: vicino.punto.tipo, km: vicino.punto.km, dist: Math.round(vicino.dist) } : null,
      ancora: S.ancora ? { nome: S.ancora.nome, km: S.ancora.km } : null,
      // un punto preso su progressiva ricostruita deve dichiararlo nell'export
      qualita: S.stimata ? 'ricostruita' : S.qualita,
      nota: S.bozza ? S.bozza.nota : ''
    };
  }

  function apriFoglio() {
    if (!S.attivo || S.km == null) return;
    S.correzioneSec = 0;
    S.bozza = null;
    S.bozza = componiBozza(0);
    aggiornaFoglio();
    $$('#chip-correzione button').forEach((b) =>
      b.classList.toggle('sel', b.dataset.sec === '0'));
    $('#foglio-nota').value = '';
    $('#foglio').hidden = false;
    if (navigator.vibrate) navigator.vibrate(35);
  }

  function aggiornaFoglio() {
    const b = S.bozza;
    if (!b) return;
    $('#foglio-km').textContent = 'km ' + formattaKm(b.km);

    const pezzi = [];
    if (b.precedente && b.successiva) pezzi.push(`${b.precedente.nome} → ${b.successiva.nome}`);
    else if (b.precedente) pezzi.push(b.precedente.nome);
    if (b.vicino) pezzi.push(`${etichettaTipo(b.vicino.tipo)} a ${b.vicino.dist} m`);
    if (b.correzioneSec && !b.correzioneApplicata) pezzi.push('correzione non disponibile');
    $('#foglio-ctx').textContent = pezzi.join(' · ') || '—';
  }

  function etichettaTipo(t) {
    return { pla: 'PL automatico', deviatoio: 'deviatoio', segnale: 'segnale',
             velocita: 'variazione velocità', capotronco: 'capotronco',
             stazione: 'stazione', fermata: 'fermata', cippo: 'cippo km' }[t] || t;
  }

  function salvaBozza() {
    if (!S.bozza) return;
    S.bozza.nota = $('#foglio-nota').value.trim();
    S.rilievi.unshift(S.bozza);
    salvaRilievi();
    S.bozza = null;
    $('#foglio').hidden = true;
    disegnaRilievi();
    notifica('Rilievo salvato.');
  }

  // -------------------------------- elenchi -------------------------------

  function disegnaRilievi() {
    const lista = $('#lista-rilievi');
    $('#conta-rilievi').textContent = S.rilievi.length;
    $('#vuoto-rilievi').hidden = S.rilievi.length > 0;
    lista.innerHTML = S.rilievi.map((r) => {
      const ctx = [];
      if (r.precedente && r.successiva) ctx.push(`${r.precedente.nome} → ${r.successiva.nome}`);
      if (r.vicino) ctx.push(`${etichettaTipo(r.vicino.tipo)} a ${r.vicino.dist} m`);
      return `<div class="voce" data-id="${r.id}">
        <div class="voce-km">${escHtml(formattaKm(r.km))}</div>
        <div class="voce-corpo">
          <div class="voce-titolo">cippo ${r.cippo} · ${r.metriDalCippo} m</div>
          <div class="voce-sub">${escHtml(r.percorsoNome || '—')} · ${escHtml(oraLocale(r.ts))}${ctx.length ? ' · ' + escHtml(ctx.join(' · ')) : ''}</div>
          ${r.nota ? `<div class="voce-nota">${escHtml(r.nota)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function disegnaLinea() {
    $('#linea-percorso-corrente').textContent = S.percorso
      ? `Percorso: ${S.percorso.nome}` : 'Nessun percorso selezionato';
    const f = S.filtroLinea;
    const punti = S.punti.filter((p) => {
      if (f === 'tutti') return true;
      if (f === 'localita') return TIPI_LOCALITA.includes(p.tipo);
      if (f === 'cippo') return p.tipo === 'cippo';
      if (f === 'pla') return p.tipo === 'pla';
      if (f === 'velocita') return p.tipo === 'velocita';
      return true;
    });
    $('#conta-punti').textContent = punti.length;
    $('#lista-linea').innerHTML = punti.map((p) => {
      const eLocalita = TIPI_LOCALITA.includes(p.tipo);
      // località e cippi hanno un nome proprio; per un PL vale l'etichetta del tipo
      const haNomeProprio = eLocalita || p.tipo === 'cippo';
      // e per un PL serve soprattutto sapere in che tratta cade
      let sotto = eLocalita || p.tipo !== 'cippo' ? `km ${escHtml(kmDecimale(p.km))}` : '';
      if (eLocalita) {
        if (p.sigla) sotto += ' · ' + escHtml(p.sigla);
      } else {
        const { prec, succ } = contesto(p.km);
        if (prec && succ) {
          const fra = `fra ${escHtml(prec.nome)} e ${escHtml(succ.nome)}`;
          sotto = sotto ? `${fra} · ${sotto}` : fra;
        }
      }
      return `
      <div class="voce">
        <div class="voce-km">${escHtml(formattaKm(p.km))}</div>
        <div class="voce-corpo">
          <div class="voce-titolo">${escHtml(haNomeProprio ? p.nome : etichettaTipo(p.tipo))}</div>
          <div class="voce-sub">
            <span class="tag tag-${escHtml(p.tipo)}">${escHtml(etichettaTipo(p.tipo))}</span>
            &nbsp;${sotto}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  /** Località (ordinate per km) di un percorso, a partire dal suo oggetto —
   *  usata anche PRIMA che quel percorso sia quello attivo (S.percorso). */
  function localitaDiPercorso(percorso) {
    return percorso.punti.filter((p) => TIPI_LOCALITA.includes(p.tipo)).sort((a, b) => a.km - b.km);
  }

  function opzioniLocalita(percorso) {
    return localitaDiPercorso(percorso)
      .map((p) => `<option value="${p.km}">${escHtml(p.nome)} — km ${escHtml(kmDecimale(p.km))}</option>`)
      .join('');
  }

  function riempiSelettorePercorsi(sel) {
    sel.innerHTML = S.rete.percorsi
      .map((p) => `<option value="${escHtml(p.id)}">${escHtml(p.nome)}</option>`)
      .join('');
  }

  /** Aggiorna le etichette "verso X" sulla schermata di partenza in base al
   *  percorso scelto lì, prima ancora di avviare il rilevamento. */
  function aggiornaVersoAvvio(percorso) {
    const loc = localitaDiPercorso(percorso);
    if (!loc.length) return;
    const basso = loc[0], alto = loc[loc.length - 1];
    const bottoni = $$('#sel-verso button');
    bottoni[0].textContent = `verso ${alto.nome}`;
    bottoni[1].textContent = `verso ${basso.nome}`;
  }

  /** Prepara i due <select> di percorso e, per ciascuno, il suo elenco di
   *  località dipendente (partenza / aggancio), inizializzati su `percorso`. */
  function riempiTendine(percorso) {
    riempiSelettorePercorsi($('#sel-percorso'));
    riempiSelettorePercorsi($('#sel-percorso-cambio'));
    $('#sel-percorso').value = percorso.id;
    $('#sel-percorso-cambio').value = percorso.id;
    $('#sel-partenza').innerHTML = opzioniLocalita(percorso);
    $('#sel-aggancio').innerHTML = opzioniLocalita(percorso);
    aggiornaVersoAvvio(percorso);
  }

  function disegnaFonti() {
    const m = S.rete.meta;
    const p = S.percorso;
    $('#fonti').innerHTML = `
      <dt>Percorso attivo</dt><dd>${p ? escHtml(p.nome) : '—'}</dd>
      <dt>Progressive chilometriche</dt><dd>${p ? escHtml(p.fonteKm) : '—'}</dd>
      <dt>Origine</dt><dd>${p ? escHtml(p.origine) : '—'}</dd>
      ${p && p.nota ? `<dt>Nota sul percorso</dt><dd>${escHtml(p.nota)}</dd>` : ''}
      <dt>Coordinate delle località</dt><dd>${escHtml(m.fonteCoord)}</dd>
      <dt>Cippi chilometrici</dt><dd>${escHtml(m.fonteCippi)}</dd>
      <dt>Dati generati il</dt><dd>${escHtml(m.generato)}</dd>`;
  }

  // -------------------------------- export --------------------------------

  const COLONNE = [
    'Percorso', 'Data e ora', 'km', 'Progressiva', 'Cippo', 'm dal cippo', 'Nota',
    'Località precedente', 'km prec.', 'Località successiva', 'km succ.',
    'Punto notevole vicino', 'Distanza (m)', 'Latitudine', 'Longitudine',
    'Precisione GPS (m)', 'Velocità (km/h)', 'Qualità posizione',
    'Correzione (s)', 'Ultimo aggancio'
  ];

  const righeRilievi = () => S.rilievi.slice().reverse().map((r) => ([
    r.percorsoNome || '',
    oraLocale(r.ts),
    r.km,
    formattaKm(r.km),
    r.cippo,
    r.metriDalCippo,
    r.nota || '',
    r.precedente ? r.precedente.nome : '',
    r.precedente ? r.precedente.km : '',
    r.successiva ? r.successiva.nome : '',
    r.successiva ? r.successiva.km : '',
    r.vicino ? `${etichettaTipo(r.vicino.tipo)} (km ${kmDecimale(r.vicino.km)})` : '',
    r.vicino ? r.vicino.dist : '',
    r.lat ?? '', r.lon ?? '',
    r.precisioneM ?? '', r.velocitaKmh ?? '',
    ETICHETTE_QUALITA[r.qualita] || r.qualita,
    r.correzioneSec || 0,
    r.ancora ? `${r.ancora.nome} (km ${kmDecimale(r.ancora.km)})` : ''
  ]));

  function scarica(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function blobCsv() {
    const cella = (v) => {
      const s = String(v ?? '');
      return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const righe = [COLONNE, ...righeRilievi()]
      .map((r) => r.map(cella).join(';')).join('\r\n');
    return new Blob(['﻿' + righe], { type: 'text/csv;charset=utf-8' });
  }

  function blobGeoJson() {
    const fc = {
      type: 'FeatureCollection',
      name: 'Rilievi rete FERROVIENORD',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: S.rilievi.slice().reverse()
        .filter((r) => r.lat != null && r.lon != null)
        .map((r) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
          properties: {
            percorso: r.percorsoNome || null,
            data_ora: oraLocale(r.ts), km: r.km, progressiva: formattaKm(r.km),
            cippo: r.cippo, m_dal_cippo: r.metriDalCippo, nota: r.nota || '',
            localita_precedente: r.precedente ? r.precedente.nome : null,
            localita_successiva: r.successiva ? r.successiva.nome : null,
            punto_vicino: r.vicino ? etichettaTipo(r.vicino.tipo) : null,
            punto_vicino_dist_m: r.vicino ? r.vicino.dist : null,
            precisione_gps_m: r.precisioneM, velocita_kmh: r.velocitaKmh,
            qualita: r.qualita, correzione_s: r.correzioneSec || 0
          }
        }))
    };
    return new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
  }

  // --- scrittore XLSX minimo (ZIP "stored", nessuna libreria esterna) ---

  const TAVOLA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = TAVOLA_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zip(voci) {
    const enc = new TextEncoder();
    const d = new Date();
    const ora = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    const data = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;

    const preparate = voci.map((v) => {
      const nome = enc.encode(v.nome);
      const dati = enc.encode(v.testo);
      return { nome, dati, crc: crc32(dati) };
    });

    let dim = 0;
    for (const p of preparate) dim += 30 + p.nome.length + p.dati.length + 46 + p.nome.length;
    dim += 22;

    const out = new Uint8Array(dim);
    const dv = new DataView(out.buffer);
    let off = 0;
    const offsets = [];

    for (const p of preparate) {
      offsets.push(off);
      dv.setUint32(off, 0x04034b50, true);
      dv.setUint16(off + 4, 20, true);
      dv.setUint16(off + 6, 0x0800, true);     // nomi in UTF-8
      dv.setUint16(off + 8, 0, true);          // metodo 0: nessuna compressione
      dv.setUint16(off + 10, ora, true);
      dv.setUint16(off + 12, data, true);
      dv.setUint32(off + 14, p.crc, true);
      dv.setUint32(off + 18, p.dati.length, true);
      dv.setUint32(off + 22, p.dati.length, true);
      dv.setUint16(off + 26, p.nome.length, true);
      dv.setUint16(off + 28, 0, true);
      off += 30;
      out.set(p.nome, off); off += p.nome.length;
      out.set(p.dati, off); off += p.dati.length;
    }

    const inizioCd = off;
    preparate.forEach((p, i) => {
      dv.setUint32(off, 0x02014b50, true);
      dv.setUint16(off + 4, 20, true);
      dv.setUint16(off + 6, 20, true);
      dv.setUint16(off + 8, 0x0800, true);
      dv.setUint16(off + 10, 0, true);
      dv.setUint16(off + 12, ora, true);
      dv.setUint16(off + 14, data, true);
      dv.setUint32(off + 16, p.crc, true);
      dv.setUint32(off + 20, p.dati.length, true);
      dv.setUint32(off + 24, p.dati.length, true);
      dv.setUint16(off + 28, p.nome.length, true);
      dv.setUint16(off + 30, 0, true);
      dv.setUint16(off + 32, 0, true);
      dv.setUint16(off + 34, 0, true);
      dv.setUint16(off + 36, 0, true);
      dv.setUint32(off + 38, 0, true);
      dv.setUint32(off + 42, offsets[i], true);
      off += 46;
      out.set(p.nome, off); off += p.nome.length;
    });

    dv.setUint32(off, 0x06054b50, true);
    dv.setUint16(off + 4, 0, true);
    dv.setUint16(off + 6, 0, true);
    dv.setUint16(off + 8, preparate.length, true);
    dv.setUint16(off + 10, preparate.length, true);
    dv.setUint32(off + 12, off - inizioCd, true);
    dv.setUint32(off + 16, inizioCd, true);
    dv.setUint16(off + 20, 0, true);

    return new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  function lettereColonna(n) {           // 1 → A, 27 → AA
    let s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
    return s;
  }

  function blobXlsx() {
    const righe = [COLONNE, ...righeRilievi()];
    const xmlRighe = righe.map((riga, i) => {
      const n = i + 1;
      const celle = riga.map((val, j) => {
        const rif = lettereColonna(j + 1) + n;
        if (typeof val === 'number' && isFinite(val)) {
          return `<c r="${rif}"><v>${val}</v></c>`;
        }
        const s = String(val ?? '');
        if (!s) return `<c r="${rif}"/>`;
        return `<c r="${rif}" t="inlineStr"><is><t xml:space="preserve">${escXml(s)}</t></is></c>`;
      }).join('');
      return `<row r="${n}">${celle}</row>`;
    }).join('');

    const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

    return zip([
      { nome: '[Content_Types].xml', testo:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>` },
      { nome: '_rels/.rels', testo:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>` },
      { nome: 'xl/workbook.xml', testo:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="${NS}" xmlns:r="${REL}">` +
        `<sheets><sheet name="Rilievi" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { nome: 'xl/_rels/workbook.xml.rels', testo:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>` +
        `</Relationships>` },
      { nome: 'xl/styles.xml', testo:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<styleSheet xmlns="${NS}">` +
        `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill>` +
        `<fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
        `</styleSheet>` },
      { nome: 'xl/worksheets/sheet1.xml', testo:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<worksheet xmlns="${NS}"><sheetData>${xmlRighe}</sheetData></worksheet>` }
    ]);
  }

  function verificaEsportabile() {
    if (!S.rilievi.length) { notifica('Non c\'è ancora nessun rilievo da esportare.'); return false; }
    return true;
  }

  async function condividi() {
    if (!verificaEsportabile()) return;
    const files = [
      new File([blobXlsx()], nomeFile('xlsx'), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      new File([blobCsv()], nomeFile('csv'), { type: 'text/csv' }),
      new File([blobGeoJson()], nomeFile('geojson'), { type: 'application/geo+json' })
    ];
    try {
      await navigator.share({ files, title: 'Rilievi rete FERROVIENORD' });
    } catch (e) {
      if (e && e.name !== 'AbortError') notifica('Condivisione non riuscita: usa i pulsanti di scaricamento.');
    }
  }

  async function esportaTraccia() {
    const punti = await tracciaLeggi();
    if (!punti.length) { notifica('Nessuna traccia registrata.'); return; }
    const fc = {
      type: 'FeatureCollection',
      name: 'Traccia GPS - ' + (S.percorso ? S.percorso.nome : 'percorso sconosciuto'),
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: punti.map((p) => [p.lon, p.lat]) },
        properties: { punti: punti.length, dal: oraLocale(punti[0].t), al: oraLocale(punti[punti.length - 1].t) }
      }]
    };
    scarica(new Blob([JSON.stringify(fc)], { type: 'application/geo+json' }),
            nomeFile('traccia.geojson'));
  }

  // ------------------------------- eventi ---------------------------------

  function collega() {
    $$('.barra button').forEach((b) => b.addEventListener('click', () => {
      $$('.barra button').forEach((x) => x.classList.toggle('sel', x === b));
      $$('.vista').forEach((v) => v.classList.toggle('attiva', v.id === b.dataset.vista));
      window.scrollTo(0, 0);
    }));

    $$('#sel-verso button').forEach((b) => b.addEventListener('click', () => {
      $$('#sel-verso button').forEach((x) => {
        const sel = x === b;
        x.classList.toggle('sel', sel);
        x.setAttribute('aria-checked', String(sel));
      });
    }));

    $('#sel-percorso').addEventListener('change', () => {
      const percorso = trovaPercorso($('#sel-percorso').value);
      if (!percorso) return;
      $('#sel-partenza').innerHTML = opzioniLocalita(percorso);
      aggiornaVersoAvvio(percorso);
    });

    $('#sel-percorso-cambio').addEventListener('change', () => {
      const percorso = trovaPercorso($('#sel-percorso-cambio').value);
      if (percorso) $('#sel-aggancio').innerHTML = opzioniLocalita(percorso);
    });

    $$('#filtri-linea button').forEach((b) => b.addEventListener('click', () => {
      $$('#filtri-linea button').forEach((x) => x.classList.toggle('sel', x === b));
      S.filtroLinea = b.dataset.filtro;
      disegnaLinea();
    }));

    $('#btn-avvia').addEventListener('click', () => {
      const percorso = trovaPercorso($('#sel-percorso').value) || S.rete.percorsi[0];
      const loc = localitaDiPercorso(percorso);
      const km = parseFloat($('#sel-partenza').value);
      const punto = loc.find((p) => p.km === km) || loc[0];
      const verso = parseInt($('#sel-verso button.sel').dataset.verso, 10);
      avvia(percorso, punto, verso);
    });

    $('#btn-aggancia').addEventListener('click', () => {
      const percorso = trovaPercorso($('#sel-percorso-cambio').value);
      if (!percorso) return;
      const km = parseFloat($('#sel-aggancio').value);
      const punto = localitaDiPercorso(percorso).find((p) => p.km === km);
      if (punto) agganciaManuale(percorso, punto);
    });

    $('#btn-registra').addEventListener('click', apriFoglio);

    $$('#chip-correzione button').forEach((b) => b.addEventListener('click', () => {
      $$('#chip-correzione button').forEach((x) => x.classList.toggle('sel', x === b));
      S.correzioneSec = parseInt(b.dataset.sec, 10);
      const nota = $('#foglio-nota').value;
      S.bozza = componiBozza(S.correzioneSec);
      S.bozza.nota = nota;
      aggiornaFoglio();
    }));

    $('#foglio-salva').addEventListener('click', salvaBozza);
    $('#foglio-elimina').addEventListener('click', () => { S.bozza = null; $('#foglio').hidden = true; });
    $('#foglio-chiudi').addEventListener('click', () => { S.bozza = null; $('#foglio').hidden = true; });
    $('#foglio').addEventListener('click', (e) => {
      if (e.target === $('#foglio')) { S.bozza = null; $('#foglio').hidden = true; }
    });

    $('#lista-rilievi').addEventListener('click', (e) => {
      const voce = e.target.closest('.voce');
      if (!voce) return;
      const r = S.rilievi.find((x) => x.id === voce.dataset.id);
      if (!r) return;
      S.bozza = r;
      S.correzioneSec = 0;
      aggiornaFoglio();
      $('#foglio-nota').value = r.nota || '';
      $$('#chip-correzione button').forEach((b) => b.classList.toggle('sel', b.dataset.sec === '0'));
      $('#foglio').hidden = false;
      // salvando si aggiorna la nota invece di aggiungere un doppione
      $('#foglio-salva').onclick = () => {
        r.nota = $('#foglio-nota').value.trim();
        salvaRilievi(); disegnaRilievi();
        S.bozza = null; $('#foglio').hidden = true;
        $('#foglio-salva').onclick = null;
        notifica('Nota aggiornata.');
      };
      $('#foglio-elimina').onclick = () => {
        S.rilievi = S.rilievi.filter((x) => x.id !== r.id);
        salvaRilievi(); disegnaRilievi();
        S.bozza = null; $('#foglio').hidden = true;
        $('#foglio-elimina').onclick = null;
        $('#foglio-salva').onclick = null;
        notifica('Rilievo eliminato.');
      };
    });

    $('#btn-xlsx').addEventListener('click', () => {
      if (verificaEsportabile()) scarica(blobXlsx(), nomeFile('xlsx'));
    });
    $('#btn-csv').addEventListener('click', () => {
      if (verificaEsportabile()) scarica(blobCsv(), nomeFile('csv'));
    });
    $('#btn-geojson').addEventListener('click', () => {
      if (verificaEsportabile()) scarica(blobGeoJson(), nomeFile('geojson'));
    });
    $('#btn-condividi').addEventListener('click', condividi);
    $('#btn-traccia').addEventListener('click', esportaTraccia);

    $('#btn-svuota-rilievi').addEventListener('click', () => {
      if (!S.rilievi.length) return;
      if (confirm(`Cancellare definitivamente ${S.rilievi.length} rilievi? Esportali prima.`)) {
        S.rilievi = []; salvaRilievi(); disegnaRilievi(); notifica('Rilievi cancellati.');
      }
    });
    $('#btn-svuota-traccia').addEventListener('click', async () => {
      if (confirm('Cancellare la traccia GPS registrata?')) {
        await tracciaSvuota(); notifica('Traccia cancellata.');
      }
    });

    $('#pill-gps').addEventListener('click', () => {
      if (!S.attivo) { notifica('Avvia il rilevamento dalla scheda Rilievo.'); return; }
      const parti = [ETICHETTE_QUALITA[S.qualita]];
      if (S.ultimoFix) {
        parti.push(`±${Math.round(S.ultimoFix.acc ?? 0)} m`);
        parti.push(`ultimo fix ${Math.round((Date.now() - S.ultimoFix.t) / 1000)} s fa`);
      }
      if (S.ancora) parti.push(`aggancio: ${S.ancora.nome}`);
      notifica(parti.join(' · '));
    });
  }

  // -------------------------------- avvio ---------------------------------

  async function inizia() {
    try {
      await caricaRete();
    } catch (e) {
      document.body.innerHTML =
        '<p style="padding:32px;font:16px system-ui;color:#eef7fa">' +
        'Dati della rete non caricati. L\'app va aperta da un server web ' +
        '(HTTPS o localhost), non con un doppio clic sul file.</p>';
      return;
    }

    caricaRilievi();

    // una sessione recente riparte dallo stesso percorso e dallo stesso punto
    const sess = leggiSessione();
    const percorsoIniziale = (sess && trovaPercorso(sess.percorsoId)) || S.rete.percorsi[0];
    selezionaPercorso(percorsoIniziale);   // solo per popolare le schede Linea/Dati: il rilevamento non è ancora attivo

    riempiTendine(percorsoIniziale);
    disegnaRilievi();
    disegnaLinea();
    disegnaFonti();
    collega();

    if (navigator.canShare && navigator.canShare({ files: [new File([''], 'x.txt', { type: 'text/plain' })] })) {
      $('#btn-condividi').hidden = false;
    }

    S.traccia.conta = await tracciaConta();
    $('#st-traccia').textContent = S.traccia.conta.toLocaleString('it-IT');

    if (sess && sess.ancora) {
      const opt = Array.from($('#sel-partenza').options)
        .find((o) => Math.abs(parseFloat(o.value) - sess.ancora.km) < 1e-6);
      if (opt) opt.selected = true;
      $$('#sel-verso button').forEach((b) => {
        const sel = parseInt(b.dataset.verso, 10) === sess.verso;
        b.classList.toggle('sel', sel);
        b.setAttribute('aria-checked', String(sel));
      });
    }

    disegna();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline non disponibile */ });
    }
  }

  inizia();
})();

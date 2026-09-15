(() => {
  "use strict";

  const W = 1200, H = 760, PAD = 62, RATIO = W / H;
  const FULL = { x: 0, y: 0, w: W, h: H };
  const COLORS = { ovest: "#16c8f4", est: "#16c8f4" };
  const app = document.querySelector("#app");
  const state = {
    area: "all", mode: "all", labels: "major", query: "",
    selection: null, view: { ...FULL }, dragging: null, dragDistance: 0, searchActive: false,
    anomalyMode: false, anomalyEvents: [], anomalyTargets: new Map(),
    anomalyUnmatched: [], importedFile: ""
  };
  let data, nodes, edges, positions, degree, bounds;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
  const fmtKm = meters => new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: meters < 10000 ? 1 : 0, maximumFractionDigits: 1
  }).format(meters / 1000);
  const fmtDate = value => value
    ? new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric" })
        .format(new Date(`${value}T12:00:00`))
    : "Non indicata";
  const clamp = (n, min, max) => Math.max(min, Math.min(n, max));
  const viewLimits = (w, h) => {
    const marginX = Math.min(280, w * .5);
    const marginY = Math.min(220, h * .5);
    return {
      minX: -marginX, maxX: W - w + marginX,
      minY: -marginY, maxY: H - h + marginY
    };
  };
  const xmlChildren = (node, name) => [...(node?.children || [])].filter(el => el.localName === name);
  const xmlFirst = (node, name) => [...(node?.getElementsByTagName("*") || [])].find(el => el.localName === name);
  const columnOf = ref => (ref.match(/[A-Z]+/i) || [""])[0].toUpperCase();
  const normalizePlace = value => String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/&/g, " E ").replace(/[’'`]/g, " ")
    .replace(/\bFERROVIENORD\b|\bFNM\b/g, " FN ")
    .replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const excelDate = value => {
    if (!value) return "—";
    if (!Number.isFinite(Number(value))) return String(value);
    const dateValue = new Date(Date.UTC(1899, 11, 30) + Number(value) * 86400000);
    return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(dateValue);
  };
  const excelTime = value => {
    if (!value) return "";
    if (!Number.isFinite(Number(value))) return String(value);
    const fraction = ((Number(value) % 1) + 1) % 1;
    const minutes = Math.round(fraction * 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  };

  async function openZip(file) {
    const buffer = await file.arrayBuffer(), view = new DataView(buffer), bytes = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Il file non contiene un archivio Excel valido.");
    const count = view.getUint16(eocd + 10, true), decoder = new TextDecoder("utf-8");
    let offset = view.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Indice Excel non valido.");
      const method = view.getUint16(offset + 10, true), compressedSize = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true), localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength)).replace(/\\/g, "/");
      entries.set(name, { method, compressedSize, localOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    const read = async name => {
      const item = entries.get(name.replace(/^\/+/, ""));
      if (!item) return null;
      const nameLength = view.getUint16(item.localOffset + 26, true), extraLength = view.getUint16(item.localOffset + 28, true);
      const start = item.localOffset + 30 + nameLength + extraLength;
      const compressed = bytes.slice(start, start + item.compressedSize);
      if (item.method === 0) return compressed;
      if (item.method !== 8 || typeof DecompressionStream === "undefined")
        throw new Error("Compressione del file Excel non supportata dal browser.");
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    };
    const text = async name => {
      const content = await read(name);
      return content ? decoder.decode(content) : null;
    };
    return { text, entries };
  }

  async function parseExcel(file) {
    if (!/\.(xlsx|xltx)$/i.test(file.name)) throw new Error("Seleziona un file .xlsx oppure .xltx.");
    const zip = await openZip(file), parser = new DOMParser();
    const workbookText = await zip.text("xl/workbook.xml");
    const relsText = await zip.text("xl/_rels/workbook.xml.rels");
    if (!workbookText || !relsText) throw new Error("Struttura della cartella Excel incompleta.");
    const workbook = parser.parseFromString(workbookText, "application/xml");
    const rels = parser.parseFromString(relsText, "application/xml");
    if (workbook.querySelector("parsererror") || rels.querySelector("parsererror")) throw new Error("XML Excel non valido.");
    const relationships = new Map([...rels.getElementsByTagName("*")]
      .filter(el => el.localName === "Relationship").map(el => [el.getAttribute("Id"), el.getAttribute("Target")]));
    const sheet = [...workbook.getElementsByTagName("*")].find(el => el.localName === "sheet");
    if (!sheet) throw new Error("Il file Excel non contiene fogli.");
    const relId = sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    let sheetPath = relationships.get(relId);
    if (!sheetPath) throw new Error("Impossibile individuare il primo foglio.");
    sheetPath = sheetPath.replace(/^\/+/, "");
    if (!sheetPath.startsWith("xl/")) sheetPath = `xl/${sheetPath}`;
    const sharedText = await zip.text("xl/sharedStrings.xml");
    const shared = [];
    if (sharedText) {
      const sharedXml = parser.parseFromString(sharedText, "application/xml");
      [...sharedXml.getElementsByTagName("*")].filter(el => el.localName === "si")
        .forEach(si => shared.push([...si.getElementsByTagName("*")].filter(el => el.localName === "t").map(t => t.textContent || "").join("")));
    }
    const sheetText = await zip.text(sheetPath);
    if (!sheetText) throw new Error("Impossibile leggere il foglio dati.");
    const sheetXml = parser.parseFromString(sheetText, "application/xml");
    const rows = [...sheetXml.getElementsByTagName("*")].filter(el => el.localName === "row");
    if (rows.length < 2) throw new Error("Il foglio non contiene righe dati.");
    const cellValue = cell => {
      const type = cell.getAttribute("t"), valueNode = xmlChildren(cell, "v")[0];
      if (type === "inlineStr") return [...cell.getElementsByTagName("*")].filter(el => el.localName === "t").map(el => el.textContent || "").join("");
      const raw = valueNode?.textContent || "";
      return type === "s" ? (shared[Number(raw)] ?? "") : raw;
    };
    const headers = new Map(xmlChildren(rows[0], "c").map(cell => [columnOf(cell.getAttribute("r") || ""), cellValue(cell).trim()]));
    const records = rows.slice(1).map(row => {
      const record = {};
      xmlChildren(row, "c").forEach(cell => {
        const column = columnOf(cell.getAttribute("r") || "");
        record[column] = cellValue(cell);
        if (headers.get(column)) record[headers.get(column)] = record[column];
      });
      return record;
    }).filter(record => Object.values(record).some(Boolean));
    if (!headers.has("N")) throw new Error("Nel foglio manca la colonna N «Località».");
    return { sheet: sheet.getAttribute("name") || "Foglio1", headers, records };
  }

  function placeAliases(node) {
    const base = [node.name, node.shortName, node.sigla].filter(Boolean).map(normalizePlace);
    return [...new Set(base.flatMap(value => [
      value, value.replace(/\bNORD\b/g, "FN"), value.replace(/\bFN\b/g, "NORD")
    ]).filter(Boolean))];
  }
  function bestNode(fragment) {
    const wanted = normalizePlace(fragment);
    if (!wanted) return null;
    let best = null;
    for (const node of data.nodes) {
      for (const alias of placeAliases(node)) {
        let score = 0;
        if (wanted === alias) score = 10;
        else if (wanted.length >= 4 && alias.includes(wanted)) score = .92;
        else if (alias.length >= 4 && wanted.includes(alias)) score = .88;
        else {
          const a = new Set(alias.split(" ").filter(word => word.length > 1));
          const w = new Set(wanted.split(" ").filter(word => word.length > 1));
          const common = [...w].filter(word => a.has(word)).length;
          score = common / Math.max(a.size, w.size, 1);
        }
        if (!best || score > best.score) best = { node, score };
      }
    }
    return best && best.score >= .5 ? best.node : null;
  }
  function matchLocation(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const direct = bestNode(text);
    const parts = text.split(/\s+(?:-|–|—|\/)\s+|\/+/).map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const matched = parts.map(bestNode).filter(Boolean);
      const unique = [...new Map(matched.map(node => [node.id, node])).values()];
      for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) {
        const edge = data.edges.find(item =>
          (item.from === unique[i].id && item.to === unique[j].id) ||
          (item.to === unique[i].id && item.from === unique[j].id));
        if (edge) return { type: "edge", id: edge.id, label: `${unique[i].name} – ${unique[j].name}` };
      }
    }
    return direct ? { type: "node", id: direct.id, label: direct.name } : null;
  }
  const recordValue = (record, ...keys) => {
    for (const key of keys) if (record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key];
    return "";
  };
  function eventFromRecord(record) {
    return {
      id: recordValue(record, "Avviso", "B"),
      location: recordValue(record, "Località", "N"),
      description: recordValue(record, "Descrizione  Avviso", "Descrizione Avviso", "C"),
      date: recordValue(record, "Inizio Guasto (Data)", "Inizio riparazione  (Data)", "Data Avviso", "Data apertura Avviso", "O", "F"),
      time: recordValue(record, "Inizio Guasto (Ora)", "Inizio riparazione (Ora)", "Ora Avviso", "Ora apertura Avviso", "P", "G"),
      object: recordValue(record, "Oggetto/Ente", "Q"),
      equipment: recordValue(record, "Equipment", "S"),
      cause: recordValue(record, "Causa", "U"),
      causeText: recordValue(record, "Testo Causa", "W"),
      unavailable: recordValue(record, "Tempo di Indisponibilità", "AR", "AK"),
      trains: recordValue(record, "Nr Treni Coinvolti", "AC", "AB"),
      delay: recordValue(record, "Minuti complessivi di ritardo", "Minuti complessivi di ritardo (Destinazione)", "AD", "AC"),
      raw: record
    };
  }
  function buildAnomalies(records) {
    const seen = new Set(), events = [], targets = new Map(), unmatched = new Map(), matchCache = new Map();
    records.forEach((record, index) => {
      const event = eventFromRecord(record);
      const uniqueKey = event.id || `riga-${index + 2}`;
      if (seen.has(uniqueKey)) return;
      seen.add(uniqueKey);
      const locationKey = normalizePlace(event.location);
      if (!matchCache.has(locationKey)) matchCache.set(locationKey, matchLocation(event.location));
      const target = matchCache.get(locationKey);
      event.target = target;
      events.push(event);
      if (target) {
        const key = `${target.type}:${target.id}`;
        if (!targets.has(key)) targets.set(key, { ...target, events: [] });
        targets.get(key).events.push(event);
      } else {
        const label = event.location || "(valore vuoto)";
        unmatched.set(label, (unmatched.get(label) || 0) + 1);
      }
    });
    return { events, targets, unmatched: [...unmatched].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count) };
  }
  function anomalyColor(count) {
    const counts = [...state.anomalyTargets.values()].map(target => target.events.length);
    const min = Math.min(...counts), max = Math.max(...counts);
    if (count <= 0) return COLORS.ovest;
    const ratio = max === min ? 1 : Math.log(count / min) / Math.log(max / min);
    const stops = [
      [0, [48, 205, 121]],
      [.30, [151, 210, 77]],
      [.55, [242, 174, 73]],
      [.78, [210, 83, 166]],
      [1, [123, 44, 191]]
    ];
    const t = clamp(ratio, 0, 1);
    let upper = stops.findIndex(stop => stop[0] >= t);
    if (upper <= 0) upper = 1;
    const [fromAt, from] = stops[upper - 1], [toAt, to] = stops[upper];
    const local = (t - fromAt) / (toAt - fromAt);
    const rgb = from.map((channel, index) => Math.round(channel + (to[index] - channel) * local));
    return `rgb(${rgb.join(",")})`;
  }

  function init(raw) {
    data = raw;
    nodes = new Map(data.nodes.map(n => [n.id, n]));
    edges = new Map(data.edges.map(e => [e.id, e]));
    bounds = {
      minX: Math.min(...data.nodes.map(n => n.x)), maxX: Math.max(...data.nodes.map(n => n.x)),
      minY: Math.min(...data.nodes.map(n => n.y)), maxY: Math.max(...data.nodes.map(n => n.y))
    };
    positions = new Map(data.nodes.map(n => [n.id, {
      x: PAD + ((n.x - bounds.minX) / (bounds.maxX - bounds.minX)) * (W - PAD * 2),
      y: H - PAD - ((n.y - bounds.minY) / (bounds.maxY - bounds.minY)) * (H - PAD * 2)
    }]));
    degree = new Map();
    data.edges.forEach(e => {
      degree.set(e.from, (degree.get(e.from) || 0) + 1);
      degree.set(e.to, (degree.get(e.to) || 0) + 1);
    });
    const initial = data.nodes.find(n => n.name === "MILANO CADORNA") || data.nodes[0];
    state.selection = { type: "node", id: initial.id };
    renderShell();
    renderAll();
    bind();
  }

  function visible() {
    const areaNodes = data.nodes.filter(n => state.area === "all" || n.component === state.area);
    const visibleNodes = areaNodes.filter(n => state.mode === "passenger" ? n.passenger :
      state.mode === "interchange" ? n.border : true);
    const areaIds = new Set(areaNodes.map(n => n.id));
    const visibleIds = new Set(visibleNodes.map(n => n.id));
    const visibleEdges = data.edges.filter(e => areaIds.has(e.from) && areaIds.has(e.to) &&
      (state.mode !== "passenger" || (visibleIds.has(e.from) && visibleIds.has(e.to))));
    return { areaNodes, visibleNodes, visibleEdges };
  }

  function renderShell() {
    app.innerHTML = `
      <main class="shell">
        <header class="topbar">
          <div class="brand"><div class="logo" aria-hidden="true"><i></i><i></i><i></i></div>
            <div><p>FERROVIENORD</p><h1>Mappa interattiva della rete</h1></div>
          </div>
          <div class="stats">
            <div class="stat"><strong>${data.meta.displayedLocalities}</strong><span>punti rete</span></div>
            <div class="stat"><strong>${data.meta.displayedSections}</strong><span>tratte uniche</span></div>
            <div class="stat"><strong>${data.meta.networkLengthKm.toLocaleString("it-IT")} km</strong><span>sviluppo rete</span></div>
          </div>
          <div class="top-actions"><button class="anomaly-entry" id="anomaly-entry"><span class="anomaly-entry-dot"></span><span id="anomaly-entry-label">Importa anomalie</span></button><div class="updated">Dati al 29 giu 2026</div></div>
        </header>
        <section class="workspace">
          <aside class="sidebar">
            <div class="panel-title"><strong>Esplora la rete</strong><span class="verified">Dati locali</span></div>
            <label class="label" for="search">Cerca località o codice</label>
            <div class="search-wrap">
              <div class="search"><input id="search" autocomplete="off" placeholder="Es. Saronno, SNO, LO5048"><button class="clear" aria-label="Azzera ricerca" title="Azzera ricerca">×</button></div>
              <div id="results"></div>
            </div>
            <fieldset><legend>Area</legend><div class="segmented" data-group="area">
              <button data-value="all">Tutta</button><button data-value="ovest">Ramo Milano</button><button data-value="est">Ramo Iseo</button>
            </div></fieldset>
            <fieldset><legend>Località visualizzate</legend><div class="choices" data-group="mode">
              <button data-value="all"><i></i><span><strong>Rete completa</strong><small>Tutti i 134 punti della rete</small></span></button>
              <button data-value="passenger"><i></i><span><strong>Servizio viaggiatori</strong><small>Località abilitate al servizio</small></span></button>
              <button data-value="interchange"><i></i><span><strong>Interconnessioni</strong><small>Punti di contatto con altra rete</small></span></button>
            </div></fieldset>
            <fieldset><legend>Etichette</legend><div class="segmented" data-group="labels">
              <button data-value="major">Principali</button><button data-value="all">Tutte</button><button data-value="none">Nessuna</button>
            </div></fieldset>
            <div class="legend"><h2>Legenda</h2>
              <div class="legend-row"><i class="swatch"></i><span><strong>Ramo Milano</strong><small>Milano · Varese · Como · Novara</small></span></div>
              <div class="legend-row"><i class="swatch est"></i><span><strong>Ramo Iseo</strong><small>Brescia · Iseo · Edolo</small></span></div>
              <div class="legend-row"><i class="swatch point"></i><span><strong>Interconnessione</strong><small>Località di altra rete</small></span></div>
            </div>
            <div class="source"><strong>Fonte: Modello Rete — Località e Tratte</strong>272 record consolidati in 136 collegamenti bidirezionali.</div>
          </aside>
          <section class="map-stage">
            <div class="map-caption"><span>Vista geografica</span><strong id="view-name">Intera rete FERROVIENORD</strong><span class="zoom-label" id="zoom-label">Zoom 100%</span></div>
            <svg id="map" class="map" role="img" aria-label="Mappa interattiva della rete FERROVIENORD">
              <defs><pattern id="minor" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#183244" stroke-width=".55"/></pattern>
              <pattern id="grid" width="120" height="120" patternUnits="userSpaceOnUse"><rect width="120" height="120" fill="url(#minor)"/><path d="M120 0H0V120" fill="none" stroke="#294657" stroke-width=".9"/></pattern></defs>
              <rect x="-600" y="-400" width="${W+1200}" height="${H+800}" fill="#071824"/><rect x="-600" y="-400" width="${W+1200}" height="${H+800}" fill="url(#grid)"/>
              <g id="edge-layer"></g><g id="node-layer"></g>
            </svg>
            <div class="controls"><button data-action="in" aria-label="Ingrandisci" title="Ingrandisci">+</button><button data-action="out" aria-label="Riduci" title="Riduci">−</button><button data-action="center" aria-label="Centra la mappa" title="Centra la mappa"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><circle cx="12" cy="12" r="2.25"/></svg></button><button data-action="reset" aria-label="Mostra tutta la rete" title="Mostra tutta la rete"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 11 8-7 8 7"/><path d="M6.5 9.5V20h11V9.5M9.5 20v-6h5v6"/></svg></button></div>
            <div class="help">Trascina per spostarti · Rotella per zoom · Seleziona stazioni e tratte</div>
          </section>
          <aside class="details" id="details"></aside>
        </section>
        <div id="anomaly-legend"></div>
        <div id="modal-root"></div>
      </main>`;
  }

  function renderAll() {
    document.querySelectorAll("[data-group]").forEach(group => {
      const key = group.dataset.group;
      group.querySelectorAll("button").forEach(b => b.classList.toggle("active", state[key] === b.dataset.value));
    });
    renderResults();
    renderMap();
    renderDetails();
    renderAnomalyLegend();
    const entry = document.querySelector("#anomaly-entry");
    const entryLabel = document.querySelector("#anomaly-entry-label");
    if (entry && entryLabel) {
      entry.classList.toggle("active", state.anomalyMode);
      entryLabel.textContent = state.anomalyEvents.length
        ? `Anomalie · ${state.anomalyEvents.length}`
        : "Importa anomalie";
    }
  }

  function renderResults() {
    const host = document.querySelector("#results");
    const q = state.query.trim().toLocaleLowerCase("it");
    document.querySelector(".clear").hidden = !q && !state.searchActive;
    if (!q) { host.innerHTML = ""; return; }
    const found = data.nodes.filter(n => [n.name,n.sigla,n.code,n.mirCode].filter(Boolean)
      .some(v => v.toLocaleLowerCase("it").includes(q)))
      .sort((a,b) => Number(b.name.toLocaleLowerCase("it").startsWith(q)) -
        Number(a.name.toLocaleLowerCase("it").startsWith(q)) || a.name.localeCompare(b.name))
      .slice(0,7);
    host.innerHTML = `<div class="results">${found.length ? found.map(n => `
      <button data-node="${n.id}"><i class="${n.component}"></i><span><strong>${esc(n.name)}</strong><small>${esc(n.sigla || "—")} · ${esc(n.code || `PIC ${n.id}`)}</small></span></button>`).join("") :
      `<div class="empty">Nessuna località trovata.</div>`}</div>`;
  }

  function closeModal() {
    document.querySelector("#modal-root").innerHTML = "";
  }
  function openImportModal() {
    const host = document.querySelector("#modal-root");
    const matchedEvents = [...state.anomalyTargets.values()].reduce((sum, target) => sum + target.events.length, 0);
    const unmatchedEvents = state.anomalyUnmatched.reduce((sum, item) => sum + item.count, 0);
    host.innerHTML = `<div class="modal-backdrop" role="presentation">
      <section class="modal-card import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <button class="modal-close" aria-label="Chiudi">×</button>
        <div class="modal-heading"><span class="modal-kicker">Dati locali</span><h2 id="import-title">Importa anomalie</h2>
          <p>Carica un modello Excel. Il file viene elaborato soltanto in questo browser e non viene inviato in rete.</p>
        </div>
        <label class="file-drop">
          <input id="excel-file" type="file" accept=".xlsx,.xltx">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>
          <span><strong>${state.importedFile ? "Sostituisci file Excel" : "Seleziona file Excel"}</strong><small>.xlsx o .xltx · elaborazione offline</small></span>
        </label>
        <div id="import-status">${state.anomalyEvents.length ? `
          <div class="import-summary">
            <div><strong>${state.anomalyEvents.length}</strong><span>eventi distinti</span></div>
            <div><strong>${state.anomalyTargets.size}</strong><span>elementi mappa</span></div>
            <div class="${unmatchedEvents ? "warning" : ""}"><strong>${unmatchedEvents}</strong><span>non associati</span></div>
          </div>
          <div class="import-file"><span>File caricato</span><strong>${esc(state.importedFile)}</strong></div>
          ${state.anomalyUnmatched.length ? `<details class="unmatched"><summary>Mostra valori non riconosciuti</summary>
            <ul>${state.anomalyUnmatched.map(item => `<li><span>${esc(item.value)}</span><strong>${item.count}</strong></li>`).join("")}</ul></details>` : ""}
          <div class="modal-actions"><button class="secondary-action" data-anomaly-action="hide" ${state.anomalyMode ? "" : "disabled"}>Nascondi anomalie</button>
            <button class="primary-action" data-anomaly-action="show">Visualizza anomalie</button></div>
          <p class="match-note">${matchedEvents} eventi associati usando la colonna N “Località”. Gli avvisi duplicati sono conteggiati una sola volta.</p>` : `
          <div class="import-placeholder"><strong>Nessun file caricato</strong><span>È richiesta la colonna N “Località”. La colonna B “Avviso” viene usata come identificativo univoco.</span></div>`}
        </div>
      </section>
    </div>`;
    const input = host.querySelector("#excel-file");
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const status = host.querySelector("#import-status");
      status.innerHTML = `<div class="import-loading"><i></i><strong>Analisi di ${esc(file.name)}…</strong><span>Lettura del foglio e associazione alla rete.</span></div>`;
      try {
        const parsed = await parseExcel(file);
        const built = buildAnomalies(parsed.records);
        state.anomalyEvents = built.events;
        state.anomalyTargets = built.targets;
        state.anomalyUnmatched = built.unmatched;
        state.importedFile = file.name;
        state.anomalyMode = false;
        openImportModal();
      } catch (error) {
        status.innerHTML = `<div class="import-error"><strong>Importazione non riuscita</strong><span>${esc(error.message)}</span></div>`;
      }
    });
  }
  function renderAnomalyLegend() {
    const host = document.querySelector("#anomaly-legend");
    if (!host) return;
    if (!state.anomalyMode || !state.anomalyTargets.size) { host.innerHTML = ""; return; }
    const counts = [...state.anomalyTargets.values()].map(target => target.events.length);
    const min = Math.min(...counts), max = Math.max(...counts);
    host.innerHTML = `<aside class="anomaly-legend">
      <div><span class="modal-kicker">Livello anomalie</span><strong>${state.anomalyEvents.length} eventi importati</strong></div>
      <div class="color-scale"></div><div class="scale-labels"><span>${min} evento${min === 1 ? "" : "i"}</span><span>${max} eventi</span></div>
      <p>Clicca una stazione o una tratta colorata per visualizzare gli eventi.</p>
      <button data-anomaly-action="hide">Nascondi anomalie</button>
    </aside>`;
  }
  function openAnomalyPopup(key) {
    const target = state.anomalyTargets.get(key);
    if (!target) return;
    const host = document.querySelector("#modal-root");
    host.innerHTML = `<div class="modal-backdrop event-backdrop" role="presentation">
      <section class="modal-card events-modal" role="dialog" aria-modal="true" aria-labelledby="events-title">
        <button class="modal-close" aria-label="Chiudi">×</button>
        <div class="modal-heading"><span class="modal-kicker">${target.type === "node" ? "Stazione / località" : "Tratta"}</span>
          <h2 id="events-title">${esc(target.label)}</h2><p><strong>${target.events.length}</strong> event${target.events.length === 1 ? "o associato" : "i associati"} dal file importato.</p></div>
        <div class="event-list">${target.events.map((event, index) => `<details class="event-card" ${index === 0 ? "open" : ""}>
          <summary><span><strong>${esc(event.description || "Avviso senza descrizione")}</strong><small>${excelDate(event.date)} ${excelTime(event.time)} · Avviso ${esc(event.id || "—")}</small></span><b>+</b></summary>
          <div class="event-body">
            <dl><div><dt>Località sorgente</dt><dd>${esc(event.location || "—")}</dd></div>
              <div><dt>Oggetto / Ente</dt><dd>${esc(event.object || "—")}</dd></div>
              <div><dt>Equipment</dt><dd>${esc(event.equipment || "—")}</dd></div>
              <div><dt>Causa</dt><dd>${esc(event.cause || "—")}</dd></div>
              <div><dt>Testo causa</dt><dd>${esc(event.causeText || "—")}</dd></div>
              <div><dt>Indisponibilità</dt><dd>${event.unavailable ? `${esc(Number(event.unavailable).toLocaleString("it-IT", { maximumFractionDigits: 2 }))} h` : "—"}</dd></div>
              <div><dt>Treni coinvolti</dt><dd>${esc(event.trains || "0")}</dd></div>
              <div><dt>Ritardo complessivo</dt><dd>${event.delay ? `${esc(event.delay)} min` : "0 min"}</dd></div></dl>
          </div></details>`).join("")}</div>
      </section>
    </div>`;
  }

  function renderMap() {
    const { visibleNodes, visibleEdges } = visible();
    const zoom = W / state.view.w;
    const svg = document.querySelector("#map");
    svg.setAttribute("viewBox", `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
    document.querySelector("#zoom-label").textContent = `Zoom ${Math.round(zoom * 100)}%`;
    document.querySelector("#view-name").textContent = state.area === "all" ? "Intera rete FERROVIENORD" :
      state.area === "est" ? "Brescia · Iseo · Edolo" : "Milano · Varese · Como · Novara";
    document.querySelector("#edge-layer").innerHTML = visibleEdges.map(e => {
      const a = positions.get(e.from), b = positions.get(e.to);
      const component = nodes.get(e.from)?.component || "ovest";
      const selected = state.selection?.type === "edge" && state.selection.id === e.id;
      const adjacent = state.selection?.type === "node" && (e.from === state.selection.id || e.to === state.selection.id);
      const anomaly = state.anomalyMode ? state.anomalyTargets.get(`edge:${e.id}`) : null;
      const stroke = anomaly ? anomalyColor(anomaly.events.length) : selected || adjacent ? "#fff" : COLORS[component];
      return `<line class="track${anomaly?" anomaly-hit":""}" data-edge="${e.id}" ${anomaly?`data-anomaly-key="edge:${e.id}"`:""} x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
        stroke="${stroke}" stroke-width="${(anomaly?6:selected?7:adjacent?4.7:2.25)/zoom}"
        stroke-opacity="${anomaly?1:state.mode==="interchange"?.2:selected?1:adjacent?.94:.72}" stroke-linecap="round">
        <title>${esc(nodes.get(e.from)?.name)} – ${esc(nodes.get(e.to)?.name)} · ${fmtKm(e.lengthMeters)} km${anomaly?` · ${anomaly.events.length} anomalie`:""}</title></line>`;
    }).join("");
    document.querySelector("#node-layer").innerHTML = visibleNodes.map(n => {
      const p = positions.get(n.id), selected = state.selection?.type === "node" && state.selection.id === n.id;
      const anomaly = state.anomalyMode ? state.anomalyTargets.get(`node:${n.id}`) : null;
      const show = selected || (state.labels !== "none" && (state.labels === "all" || n.major || (degree.get(n.id)||0)>=3 || zoom>=2.4));
      const r = (selected?8:n.major?5.5:4.2)/zoom, stroke = selected?"#fff":"#071824";
      const fill = anomaly ? anomalyColor(anomaly.events.length) : COLORS[n.component];
      const shape = n.border
        ? `<rect class="node-shape" x="${p.x-r}" y="${p.y-r}" width="${r*2}" height="${r*2}" rx="${1.5/zoom}" transform="rotate(45 ${p.x} ${p.y})" fill="${anomaly?fill:"#ffbf47"}" stroke="${stroke}" stroke-width="${1.5/zoom}"/>`
        : `<circle class="node-shape" cx="${p.x}" cy="${p.y}" r="${anomaly?r*1.35:r}" fill="${fill}" stroke="${stroke}" stroke-width="${1.5/zoom}"/>`;
      return `<g class="station${anomaly?" anomaly-hit":""}" data-node="${n.id}" ${anomaly?`data-anomaly-key="node:${n.id}"`:""} tabindex="0">${shape}${show?`<text x="${p.x+10/zoom}" y="${p.y-8/zoom}" fill="#edf8fb" font-size="${(selected?12:9.2)/zoom}" font-weight="${selected||n.major?700:500}" paint-order="stroke" stroke="#071824" stroke-width="${3/zoom}">${esc(n.shortName||n.name)}</text>`:""}<title>${esc(n.name)}${anomaly?` · ${anomaly.events.length} anomalie`:""}</title></g>`;
    }).join("");
  }

  function renderDetails() {
    const host = document.querySelector("#details");
    if (state.selection?.type === "edge") {
      const e = edges.get(state.selection.id), a = nodes.get(e.from), b = nodes.get(e.to);
      host.innerHTML = `<span class="badge ${a.component}">Tratta · ${a.component === "est" ? "Ramo Iseo" : "Ramo Milano"}</span>
        <h2>${esc(a.name)}<br><span style="color:var(--muted);font-size:15px">↕</span><br>${esc(b.name)}</h2>
        <p class="subtitle">${esc(e.routeCode || "Codice itinerario non indicato")}</p>
        <div class="length"><span>Lunghezza tratta</span><strong>${fmtKm(e.lengthMeters)} km</strong></div>
        <h3 class="section-title">Caratteristiche tecniche</h3><dl class="tech">
          <div><dt>Tipo tratta</dt><dd>${e.typeCode}</dd></div><div><dt>Blocco</dt><dd>${e.blockCode}</dd></div>
          <div><dt>Trazione</dt><dd>${e.tractionCode}</dd></div><div><dt>Esercizio</dt><dd>${e.operationCode}</dd></div>
          <div><dt>Traffico</dt><dd>${esc(e.traffic)}</dd></div><div><dt>Attiva dal</dt><dd>${fmtDate(e.activeFrom)}</dd></div>
        </dl>`;
      return;
    }
    const n = nodes.get(state.selection.id);
    const conn = [];
    data.edges.forEach(e => {
      if (e.from !== n.id && e.to !== n.id) return;
      const other = nodes.get(e.from === n.id ? e.to : e.from);
      conn.push({ edge:e, node:other });
    });
    conn.sort((a,b)=>a.node.name.localeCompare(b.node.name));
    host.innerHTML = `<span class="badge ${n.component}">${n.component === "est" ? "Ramo Iseo" : "Ramo Milano"}</span>${n.border?'<span class="badge border">Interconnessione</span>':""}
      <h2>${esc(n.name)}</h2><p class="subtitle">${esc(n.shortName || "Località di rete")}</p>
      <div class="detail-grid">
        <div><span>Sigla</span><strong>${esc(n.sigla||"—")}</strong></div><div><span>Codice località</span><strong>${esc(n.code||"—")}</strong></div>
        <div><span>Codice MIR</span><strong>${esc(n.mirCode||"—")}</strong></div><div><span>Servizio</span><strong>${n.passenger?"Viaggiatori":"Non viaggiatori"}</strong></div>
      </div>
      <h3 class="section-title"><span>Collegamenti diretti</span><span>${conn.length}</span></h3>
      <div class="connections">${conn.length?conn.map(c=>`<button data-node="${c.node.id}"><i class="${c.node.component}"></i><span><strong>${esc(c.node.name)}</strong><small>${fmtKm(c.edge.lengthMeters)} km · ${esc(c.edge.traffic)}</small></span><b>›</b></button>`).join(""):'<div class="empty">Nessun collegamento diretto.</div>'}</div>
      <h3 class="section-title">Dati tecnici</h3><dl class="tech">
        <div><dt>Quota</dt><dd>${n.altitude!=null&&n.altitude>=0?`${n.altitude.toLocaleString("it-IT")} m`:"Non indicata"}</dd></div>
        <div><dt>Tipo località</dt><dd>${n.typeCode}</dd></div><div><dt>Traffico</dt><dd>${esc(n.traffic)}</dd></div>
        <div><dt>Merci</dt><dd>${n.freight?"Sì":"No"}</dd></div><div><dt>Attiva dal</dt><dd>${fmtDate(n.activeFrom)}</dd></div>
      </dl>`;
  }

  function fit(list) {
    if (!list.length) return { ...FULL };
    const pts=list.map(n=>positions.get(n.id)), minX=Math.min(...pts.map(p=>p.x)), maxX=Math.max(...pts.map(p=>p.x));
    const minY=Math.min(...pts.map(p=>p.y)), maxY=Math.max(...pts.map(p=>p.y));
    const mapRect = document.querySelector("#map")?.getBoundingClientRect();
    const viewportRatio = mapRect?.width && mapRect?.height ? mapRect.width / mapRect.height : RATIO;
    let w=Math.max((maxX-minX)*1.18,260), h=Math.max((maxY-minY)*1.18,190);
    if(w/h>viewportRatio)h=w/viewportRatio;else w=h*viewportRatio;
    const scale=Math.min(1,W/w,H/h);
    w*=scale;h*=scale;
    const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
    return{x:centerX-w/2,y:centerY-h/2,w,h};
  }
  function zoomAt(factor,cx,cy) {
    const v=state.view, centerX=cx??v.x+v.w/2, centerY=cy??v.y+v.h/2;
    const w=clamp(v.w/factor,250,W),h=w/RATIO,rx=(centerX-v.x)/v.w,ry=(centerY-v.y)/v.h;
    const limits=viewLimits(w,h);
    state.view={x:clamp(centerX-rx*w,limits.minX,limits.maxX),y:clamp(centerY-ry*h,limits.minY,limits.maxY),w,h};renderMap();
  }
  function focusNode(id, fromSearch=false) {
    const n=nodes.get(Number(id)),p=positions.get(n.id),w=430,h=w/RATIO;
    state.selection={type:"node",id:n.id};state.area="all";
    state.searchActive=fromSearch;
    state.view={x:clamp(p.x-w/2,0,W-w),y:clamp(p.y-h/2,0,H-h),w,h};
    state.query="";document.querySelector("#search").value="";renderAll();
  }
  function selectFromTarget(target) {
    const node=target.closest("[data-node]"),edge=target.closest("[data-edge]");
    if(node){
      const id=Number(node.dataset.node), anomalyKey=`node:${id}`;
      focusNode(id,Boolean(target.closest(".results")));
      if(state.anomalyMode&&state.anomalyTargets.has(anomalyKey))openAnomalyPopup(anomalyKey);
      return true
    }
    if(edge){
      const id=Number(edge.dataset.edge), anomalyKey=`edge:${id}`;
      state.selection={type:"edge",id};renderMap();renderDetails();
      if(state.anomalyMode&&state.anomalyTargets.has(anomalyKey))openAnomalyPopup(anomalyKey);
      return true
    }
    return false;
  }
  function bind() {
    document.addEventListener("click", e => {
      if(e.target.closest("#anomaly-entry")){openImportModal();return}
      if(e.target.closest(".modal-close")||e.target.classList.contains("modal-backdrop")){closeModal();return}
      const anomalyAction=e.target.closest("[data-anomaly-action]")?.dataset.anomalyAction;
      if(anomalyAction==="show"){
        state.anomalyMode=true;closeModal();renderAll();return
      }
      if(anomalyAction==="hide"){
        state.anomalyMode=false;closeModal();renderAll();return
      }
      if (selectFromTarget(e.target)) return;
      const group=e.target.closest("[data-group]"), button=e.target.closest("button[data-value]");
      if(group&&button){const key=group.dataset.group;state[key]=button.dataset.value;
        if(key==="area"){
          if(state.area==="all"){
            state.view={...FULL};
          }else{
            const branchNodes=data.nodes.filter(n=>n.component===state.area);
            state.view=fit(branchNodes);
            const anchorName=state.area==="est"?"ISEO":"MILANO CADORNA";
            const anchor=branchNodes.find(n=>n.name===anchorName)||branchNodes.find(n=>n.major)||branchNodes[0];
            if(anchor)state.selection={type:"node",id:anchor.id};
          }
        }
        renderAll();return}
      const action=e.target.closest("[data-action]")?.dataset.action;
      if(action==="in")zoomAt(1.25);if(action==="out")zoomAt(.8);
      if(action==="center"){
        state.view=state.area==="all"?{...FULL}:fit(data.nodes.filter(n=>n.component===state.area));
        renderMap();
      }
      if(action==="reset"){state.view={...FULL};state.area="all";renderAll()}
      if(e.target.closest(".clear")){
        state.query="";state.searchActive=false;document.querySelector("#search").value="";
        state.view=state.area==="all"?{...FULL}:fit(data.nodes.filter(n=>n.component===state.area));
        const anchorName=state.area==="est"?"ISEO":"MILANO CADORNA";
        const anchor=data.nodes.find(n=>n.name===anchorName);
        if(anchor)state.selection={type:"node",id:anchor.id};
        renderAll();
      }
    });
    const search=document.querySelector("#search");
    search.addEventListener("input",e=>{state.query=e.target.value;renderResults()});
    const svg=document.querySelector("#map");
    svg.addEventListener("click",e=>{
      if(state.dragDistance>4){state.dragDistance=0;return}
      const hit=e.target.closest?.("[data-anomaly-key]");
      if(!state.anomalyMode||!hit)return;
      const key=hit.dataset.anomalyKey,target=state.anomalyTargets.get(key);
      if(!target)return;
      e.stopPropagation();
      state.selection={type:target.type,id:target.id};
      renderMap();renderDetails();openAnomalyPopup(key);
    });
    svg.addEventListener("wheel",e=>{e.preventDefault();const r=svg.getBoundingClientRect(),v=state.view;
      zoomAt(e.deltaY<0?1.18:.84,v.x+(e.clientX-r.left)/r.width*v.w,v.y+(e.clientY-r.top)/r.height*v.h)},{passive:false});
    svg.addEventListener("pointerdown",e=>{if(e.button!==0)return;svg.setPointerCapture(e.pointerId);
      state.dragDistance=0;state.dragging={id:e.pointerId,x:e.clientX,y:e.clientY,view:{...state.view}};svg.classList.add("dragging")});
    svg.addEventListener("pointermove",e=>{const s=state.dragging;if(!s||s.id!==e.pointerId)return;
      const r=svg.getBoundingClientRect(),dx=(e.clientX-s.x)/r.width*s.view.w,dy=(e.clientY-s.y)/r.height*s.view.h;
      state.dragDistance=Math.max(state.dragDistance,Math.hypot(e.clientX-s.x,e.clientY-s.y));
      const limits=viewLimits(s.view.w,s.view.h);
      state.view={...s.view,x:clamp(s.view.x-dx,limits.minX,limits.maxX),y:clamp(s.view.y-dy,limits.minY,limits.maxY)};renderMap()});
    const stop=e=>{if(state.dragging?.id===e.pointerId){state.dragging=null;svg.classList.remove("dragging")}};
    svg.addEventListener("pointerup",stop);svg.addEventListener("pointercancel",stop);
    document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal()});
  }

  fetch("network-data.json", { cache: "no-store" }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
  }).then(init).catch(error => {
    app.innerHTML = `<div class="error"><strong>Impossibile caricare i dati della rete.</strong><p>${esc(error.message)}. Avvia la mappa tramite “Avvia Mappa.cmd”; l’apertura diretta di index.html non è supportata dai browser.</p></div>`;
  });
})();

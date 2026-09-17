// Importazione "best effort" di un RDS già compilato in formato Word (.docx)
// dentro la struttura dell'app. Nessuna libreria esterna: un .docx è uno zip
// (stesso approccio già usato in portable/app.js per gli .xlsx), il cui
// word/document.xml viene attraversato in ordine per riconoscere titoli di
// sezione, tabelle e blocco Generalità.
//
// Il riconoscimento è per TITOLO di sezione (non per numero, che in Word è
// spesso generato automaticamente e non compare come testo), confrontato in
// ordine crescente con l'indice dello schema: questo permette di distinguere
// titoli ripetuti (es. "Aggiornamenti" compare sia in Parte Prima che in
// Parte Seconda) in base a quale viene incontrato per primo nel documento.
//
// L'importazione è pensata come punto di partenza da verificare e correggere
// nell'editor, non come conversione garantita al 100%.

(function (global) {
  "use strict";

  const render = global.RDS.render;

  // ---- Lettura zip (.docx) -----------------------------------------------
  async function openZip(file) {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("Il file non contiene un archivio .docx valido.");
    const count = view.getUint16(eocd + 10, true);
    const decoder = new TextDecoder("utf-8");
    let offset = view.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Indice dell'archivio .docx non valido.");
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength)).replace(/\\/g, "/");
      entries.set(name, { method, compressedSize, localOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    const read = async (name) => {
      const item = entries.get(name.replace(/^\/+/, ""));
      if (!item) return null;
      const nameLength = view.getUint16(item.localOffset + 26, true);
      const extraLength = view.getUint16(item.localOffset + 28, true);
      const start = item.localOffset + 30 + nameLength + extraLength;
      const compressed = bytes.slice(start, start + item.compressedSize);
      if (item.method === 0) return compressed;
      if (item.method !== 8 || typeof DecompressionStream === "undefined") {
        throw new Error("Compressione del file Word non supportata da questo browser.");
      }
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    };
    const text = async (name) => {
      const content = await read(name);
      return content ? decoder.decode(content) : null;
    };
    return { text, entries };
  }

  // ---- Estrazione blocchi ordinati (paragrafi e tabelle) -----------------
  function localName(el) {
    return el.localName || el.nodeName.replace(/^.*:/, "");
  }

  function paragraphText(pEl) {
    const parts = [];
    [...pEl.getElementsByTagName("*")].forEach((e) => {
      const ln = localName(e);
      if (ln === "t") parts.push(e.textContent || "");
      else if (ln === "br" || ln === "cr") parts.push("\n");
      else if (ln === "tab") parts.push("\t");
    });
    return parts.join("");
  }

  function tableRows(tblEl) {
    const trs = [...tblEl.getElementsByTagName("*")].filter((e) => localName(e) === "tr");
    return trs.map((tr) => {
      const tcs = [...tr.children].filter((e) => localName(e) === "tc");
      return tcs.map((tc) => {
        const ps = [...tc.getElementsByTagName("*")].filter((e) => localName(e) === "p");
        return ps.map(paragraphText).join("\n").trim();
      });
    });
  }

  function collectBlocks(bodyEl) {
    const out = [];
    (function walk(node) {
      [...node.children].forEach((child) => {
        const ln = localName(child);
        if (ln === "p") out.push({ type: "p", text: paragraphText(child) });
        else if (ln === "tbl") out.push({ type: "tbl", rows: tableRows(child) });
        else walk(child);
      });
    })(bodyEl);
    return out;
  }

  // ---- Normalizzazione titoli ---------------------------------------------
  function stripAccents(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function normalizeTitle(s) {
    return stripAccents(String(s || ""))
      .toUpperCase()
      .replace(/^\s*\d+(\.\d+){0,5}\.?\s*/, "")
      .replace(/[.:;]+\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isSiLike(v) {
    return /^(s[iì]|x|yes)$/i.test(String(v || "").trim());
  }

  // ---- Import principale ---------------------------------------------------
  async function importDocx(file, templateId) {
    const TEMPLATES = global.RDS.TEMPLATES;
    const template = TEMPLATES[templateId] || TEMPLATES.stazione;
    const warnings = [];

    const zip = await openZip(file);
    const xmlText = await zip.text("word/document.xml");
    if (!xmlText) throw new Error("Il file non contiene word/document.xml: non sembra un .docx valido.");
    const xml = new DOMParser().parseFromString(xmlText, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("XML del documento Word non leggibile.");
    const bodyEl = [...xml.getElementsByTagName("*")].find((e) => localName(e) === "body");
    if (!bodyEl) throw new Error("Struttura del documento Word non riconosciuta.");

    const blocks = collectBlocks(bodyEl);

    // Il timbro Edizione/Aggiornamento/Data è spesso nell'intestazione o nel
    // piè di pagina di Word (ripetuto su ogni pagina), non nel corpo del testo.
    const headerFooterNames = [...zip.entries.keys()].filter((n) => /^word\/(header|footer)\d*\.xml$/i.test(n));
    const headerFooterTexts = [];
    for (const name of headerFooterNames) {
      const hfText = await zip.text(name);
      if (!hfText) continue;
      const hfXml = new DOMParser().parseFromString(hfText, "application/xml");
      if (hfXml.querySelector("parsererror")) continue;
      const root = hfXml.documentElement;
      if (root) headerFooterTexts.push(collectBlocks(root).filter((b) => b.type === "p").map((b) => b.text).join("\n"));
    }
    const headerFooterJoined = headerFooterTexts.join("\n");

    const orderedNodes = render.flattenAll(template.parteUno).concat(template.hasPartSeconda ? render.flattenAll(template.parteDue) : []);
    const titleOf = (node) => normalizeTitle(node.title);

    const doc = global.RDS.storage.createBlank(templateId, "");

    let cursor = -1; // indice in orderedNodes dell'ultimo nodo riconosciuto
    let currentLeaf = null; // nodo leaf corrente su cui accumulare testo/tabelle
    let sawFirstHeading = false;
    const frontText = [];
    let metaTable = null;
    const perLeaf = new Map(); // nodeId -> { texts: [], tables: [] }
    let systemItems = null; // per il campo systemlist (posto di servizio, sezione 2)

    function leafBucket(node) {
      if (!perLeaf.has(node.id)) perLeaf.set(node.id, { texts: [], tables: [] });
      return perLeaf.get(node.id);
    }

    function findMatchingNode(text) {
      const norm = normalizeTitle(text);
      if (!norm || norm.length > 140) return -1;
      for (let i = cursor + 1; i < orderedNodes.length; i++) {
        if (titleOf(orderedNodes[i]) === norm) return i;
      }
      return -1;
    }

    blocks.forEach((block) => {
      if (block.type === "p") {
        const text = (block.text || "").trim();
        if (!text) return;
        const matchIdx = findMatchingNode(text);
        if (matchIdx >= 0) {
          sawFirstHeading = true;
          cursor = matchIdx;
          const node = orderedNodes[matchIdx];
          if (node.kind === "leaf") {
            currentLeaf = node;
            leafBucket(node);
            if (templateId === "posto_servizio" && node.id === "2") systemItems = [];
            else systemItems = null;
          } else {
            currentLeaf = null;
            systemItems = null;
          }
          return;
        }
        if (!sawFirstHeading) {
          frontText.push(text);
          return;
        }
        if (systemItems) {
          const looksLikeTitle = text.length <= 90 && !/[.:]$/.test(text);
          if (looksLikeTitle || systemItems.length === 0) {
            systemItems.push({ titolo: text.replace(/^\s*\d+(\.\d+)*\.?\s*/, ""), testo: "" });
          } else {
            systemItems[systemItems.length - 1].testo += (systemItems[systemItems.length - 1].testo ? "\n" : "") + text;
          }
          leafBucket(currentLeaf).systemItems = systemItems;
          return;
        }
        if (currentLeaf) {
          leafBucket(currentLeaf).texts.push(text);
        } else {
          frontText.push(text);
        }
        return;
      }
      // tabella
      if (!sawFirstHeading) {
        if (!metaTable) metaTable = block.rows;
        return;
      }
      if (currentLeaf) {
        leafBucket(currentLeaf).tables.push(block.rows);
      } else {
        warnings.push("Trovata una tabella fuori da una sezione riconosciuta: controllare manualmente.");
      }
    });

    // ---- Frontespizio (corpo + intestazioni/piè di pagina) -------------------
    const frontJoined = frontText.join("\n") + "\n" + headerFooterJoined;
    const denomMatch = frontJoined.match(/LOCALIT[ÀA]\s+DI\s+SERVIZIO\s*:?\s*(.+)/i) || frontJoined.match(/POSTO\s+DI\s+SERVIZIO\s*:?\s*(.+)/i);
    if (denomMatch) doc.meta.denominazione = denomMatch[1].trim().replace(/\s{2,}/g, " ");
    const edMatch = frontJoined.match(/Edizione\s*:?\s*([0-9]{1,3})/i);
    if (edMatch) doc.meta.edizione = edMatch[1];
    const aggMatch = frontJoined.match(/Aggiornamento\s*n[°ºo]?\.?\s*:?\s*([0-9]{1,3})/i);
    if (aggMatch) doc.meta.aggiornamento = aggMatch[1];
    const dataMatch = frontJoined.match(/Entrata\s+in\s+vigore\s*:?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4}|[0-9]{1,2}\s+\w+\s+[0-9]{4})/i);
    if (dataMatch) doc.meta.data_entrata_vigore = dataMatch[1];
    if (!edMatch && !aggMatch && !dataMatch) {
      warnings.push("Timbro Edizione/Aggiornamento/Data non trovato: inseriscilo a mano (di solito è nell'intestazione di pagina del Word).");
    }

    // ---- Blocco Generalità (tabella campo -> valore) -------------------------
    function matchMetaField(label) {
      const norm = normalizeTitle(label);
      // 1) corrispondenza esatta con l'etichetta prevista
      let field = template.metaFields.find((f) => normalizeTitle(f.label) === norm);
      if (field) return field;
      // 2) corrispondenza per parole chiave (etichette reali spesso formulate diversamente)
      return template.metaFields.find((f) => (f.match || []).some((words) => words.every((w) => norm.includes(w))));
    }
    if (metaTable) {
      metaTable.forEach((row) => {
        if (row.length < 2) return;
        const field = matchMetaField(row[0]);
        if (field) doc.meta[field.key] = row[1];
      });
    } else {
      warnings.push("Non ho trovato la tabella «Generalità»: denominazione e dati anagrafici vanno controllati a mano.");
    }
    if (!doc.meta.denominazione) warnings.push("Denominazione non riconosciuta automaticamente: inseriscila a mano.");
    template.metaFields.forEach((f) => {
      if (f.key !== "denominazione" && !doc.meta[f.key]) {
        warnings.push(`Campo Generalità «${f.label}» non riconosciuto: controllare a mano.`);
      }
    });

    // ---- Assegnazione contenuti alle sezioni ---------------------------------
    orderedNodes.forEach((node) => {
      if (node.kind !== "leaf") return;
      const bucket = perLeaf.get(node.id);
      const section = render.ensureSection(doc, node.id);
      if (!bucket) return; // sezione mai incontrata nel documento: resta vuota

      const tableFields = node.fields.filter((f) => f.type === "table");
      const matrixField = node.fields.find((f) => f.type === "matrix");
      const systemField = node.fields.find((f) => f.type === "systemlist");
      const textFields = node.fields.filter((f) => f.type === "textarea" || f.type === "text");

      if (systemField && bucket.systemItems && bucket.systemItems.length) {
        section.values[systemField.key] = bucket.systemItems;
      }

      let tableIdx = 0;
      bucket.tables.forEach((rows) => {
        if (!rows.length) return;
        if (matrixField && tableFields.length === 0) {
          const header = rows[0];
          const cols = header.slice(1);
          const dataRows = rows.slice(1);
          const cells = {};
          dataRows.forEach((r) => {
            const rowLabel = r[0] || "";
            cols.forEach((c, ci) => {
              if (isSiLike(r[ci + 1])) cells[rowLabel + "|" + c] = true;
            });
          });
          section.values[matrixField.key] = { rows: dataRows.map((r) => r[0] || ""), cols, cells };
          return;
        }
        const field = tableFields[tableIdx];
        tableIdx++;
        if (!field) {
          const serialized = rows.map((r) => r.join(" | ")).join("\n");
          if (textFields.length) {
            bucket.texts.push("[Tabella non riconosciuta, riportata come testo]\n" + serialized);
            warnings.push(`${node.id} ${node.title}: una tabella non corrispondeva a nessun campo previsto, riportata come testo nella sezione (verificare a mano).`);
          } else {
            warnings.push(
              `${node.id} ${node.title}: una tabella non corrispondeva a nessun campo previsto e questa sezione non ha un campo di testo dove metterla. Contenuto della tabella:\n${serialized}`
            );
          }
          return;
        }
        const dataRows = rows.slice(1); // salta l'intestazione
        section.values[field.key] = dataRows
          .filter((r) => r.some((c) => c && c.trim()))
          .map((r) => {
            const obj = {};
            field.columns.forEach((col, ci) => {
              obj[col.key] = r[ci] || "";
            });
            return obj;
          });
      });

      const text = bucket.texts.join("\n\n").trim();
      if (node.id === "3.3.3" && text) {
        const quadroFields = { A: "quadro_a", B: "quadro_b", C: "quadro_c" };
        const re = /Quadro\s*([ABC])\s*[:\-–]?\s*/gi;
        const parts = text.split(re);
        // parts: [testoPrima, 'A', testoA, 'B', testoB, 'C', testoC, ...]
        if (parts.length > 1) {
          for (let i = 1; i < parts.length; i += 2) {
            const key = quadroFields[parts[i].toUpperCase()];
            if (key) section.values[key] = (section.values[key] ? section.values[key] + "\n" : "") + (parts[i + 1] || "").trim();
          }
        } else if (textFields[0]) {
          section.values[textFields[0].key] = text;
        }
      } else if (textFields.length && text) {
        if (/^per memoria\.?$/i.test(text) && !node.noPerMemoria) {
          section.perMemoria = true;
        } else {
          section.values[textFields[0].key] = text;
        }
      } else if (text && !tableFields.length && !matrixField && !systemField) {
        warnings.push(`${node.id} ${node.title}: testo trovato ma nessun campo compatibile, controllare a mano.`);
      }
    });

    return { doc, warnings };
  }

  global.RDS = global.RDS || {};
  // ---- Report leggibile del risultato dell'importazione -------------------
  function fieldSummary(field, value) {
    if (field.type === "table") {
      const rows = Array.isArray(value) ? value : [];
      return `${field.label}: ${rows.length} rig${rows.length === 1 ? "a" : "he"}`;
    }
    if (field.type === "matrix") {
      const rows = (value && value.rows) || [];
      const cols = (value && value.cols) || [];
      return `${field.label}: ${rows.length} attività × ${cols.length} agenti`;
    }
    if (field.type === "systemlist") {
      const items = Array.isArray(value) ? value : [];
      return `${field.label}: ${items.length} vo${items.length === 1 ? "ce" : "ci"}`;
    }
    const text = (value || "").trim();
    return `${field.label}: ${text ? text.length + " caratteri" : "(vuoto)"}`;
  }

  function buildReport(doc, template, warnings, filename) {
    const lines = [];
    lines.push("REPORT IMPORTAZIONE RDS");
    lines.push("File: " + (filename || "-"));
    lines.push("Template: " + template.label);
    lines.push("");
    lines.push("-- Generalità --");
    template.metaFields.forEach((f) => lines.push(`${f.label}: ${doc.meta[f.key] || "(vuoto)"}`));
    lines.push(`Edizione: ${doc.meta.edizione || "-"} | Aggiornamento: ${doc.meta.aggiornamento || "-"} | Entrata in vigore: ${doc.meta.data_entrata_vigore || "-"}`);
    lines.push("");

    function printNodes(nodes, indent) {
      nodes.forEach((node) => {
        if (node.kind === "group") {
          lines.push(`${indent}${node.id}. ${node.title}`);
          printNodes(node.children, indent + "  ");
          return;
        }
        const section = (doc.sections && doc.sections[node.id]) || {};
        if (section.perMemoria) {
          lines.push(`${indent}${node.id}. ${node.title} — Per memoria.`);
          return;
        }
        const values = section.values || {};
        const hasAny = node.fields.some((f) => {
          const v = values[f.key];
          if (f.type === "table" || f.type === "systemlist") return Array.isArray(v) && v.length;
          if (f.type === "matrix") return v && v.rows && v.rows.length;
          return v && String(v).trim();
        });
        if (!hasAny) {
          lines.push(`${indent}${node.id}. ${node.title} — vuoto`);
          return;
        }
        lines.push(`${indent}${node.id}. ${node.title}`);
        node.fields.forEach((f) => {
          lines.push(`${indent}   - ${fieldSummary(f, values[f.key])}`);
        });
      });
    }

    lines.push("-- PARTE PRIMA --");
    printNodes(template.parteUno, "");
    if (template.hasPartSeconda) {
      lines.push("");
      lines.push("-- PARTE SECONDA --");
      printNodes(template.parteDue, "");
    }

    lines.push("");
    lines.push("-- Avvisi da controllare a mano --");
    lines.push(warnings.length ? warnings.map((w) => "- " + w).join("\n") : "(nessuno)");

    return lines.join("\n");
  }

  global.RDS.docximport = { importDocx, buildReport };
})(window);

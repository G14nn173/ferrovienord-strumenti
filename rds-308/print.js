// Costruisce la vista stampabile (frontespizio + contenuti) a partire dallo
// schema e dai dati del documento. Pensata per essere stampata/esportata in
// PDF con la stampa del browser (Ctrl+P / window.print()).
(function (global) {
  "use strict";

  const el = global.RDS.render.el;

  function textOrDash(v) {
    return v && String(v).trim() ? v : "—";
  }

  function renderTableReadOnly(field, rows) {
    if (!rows || !rows.length) return el("p", { class: "print-empty", text: "Nessun dato inserito." });
    const table = el("table", { class: "print-table" });
    const thead = el("thead", {}, [el("tr", {}, field.columns.map((c) => el("th", { text: c.label })))]);
    const tbody = el(
      "tbody",
      {},
      rows.map((row) => el("tr", {}, field.columns.map((c) => el("td", { text: textOrDash(row[c.key]) }))))
    );
    table.appendChild(thead);
    table.appendChild(tbody);
    return table;
  }

  function renderMatrixReadOnly(data) {
    if (!data || !data.rows || !data.rows.length || !data.cols || !data.cols.length) {
      return el("p", { class: "print-empty", text: "Nessun dato inserito." });
    }
    const table = el("table", { class: "print-table" });
    const headRow = el("tr", {}, [el("th", { text: "Attività / Agente" })].concat(data.cols.map((c) => el("th", { text: c }))));
    const thead = el("thead", {}, [headRow]);
    const tbody = el(
      "tbody",
      {},
      data.rows.map((r) =>
        el(
          "tr",
          {},
          [el("td", { text: r })].concat(data.cols.map((c) => el("td", { class: "cell-center", text: data.cells[r + "|" + c] ? "X" : "" })))
        )
      )
    );
    table.appendChild(thead);
    table.appendChild(tbody);
    return table;
  }

  function renderSystemListReadOnly(items) {
    if (!items || !items.length) return el("p", { class: "print-empty", text: "Nessun dato inserito." });
    const wrap = el("div", { class: "print-systemlist" });
    items.forEach((item) => {
      if (!item.titolo && !item.testo) return;
      wrap.appendChild(el("p", {}, [el("strong", { text: item.titolo || "(senza titolo)" })]));
      wrap.appendChild(el("p", { class: "print-text", text: item.testo || "Per memoria." }));
    });
    return wrap;
  }

  function renderFieldReadOnly(field, value) {
    if (field.type === "table") return renderTableReadOnly(field, value);
    if (field.type === "matrix") return renderMatrixReadOnly(value);
    if (field.type === "systemlist") return renderSystemListReadOnly(value);
    const wrap = el("div", { class: "print-field" });
    if (field.type !== "table") wrap.appendChild(el("p", { class: "print-field-label", text: field.label }));
    wrap.appendChild(el("p", { class: "print-text", text: value ? value : "Per memoria." }));
    return wrap;
  }

  function renderLeafReadOnly(node, doc) {
    const section = (doc.sections && doc.sections[node.id]) || { perMemoria: false, values: {} };
    const wrap = el("div", { class: "print-leaf" });
    wrap.appendChild(el("h4", { text: `${node.id}. ${node.title}` }));
    if (section.perMemoria) {
      wrap.appendChild(el("p", { class: "print-text", text: "Per memoria." }));
      return wrap;
    }
    node.fields.forEach((f) => {
      const value = section.values ? section.values[f.key] : undefined;
      wrap.appendChild(renderFieldReadOnly(f, value));
    });
    return wrap;
  }

  function renderNodeReadOnly(node, doc, depth) {
    if (node.kind === "leaf") return renderLeafReadOnly(node, doc);
    const tag = depth === 0 ? "h2" : "h3";
    const wrap = el("div", { class: "print-group" });
    wrap.appendChild(el(tag, { text: `${node.id}. ${node.title}` }));
    node.children.forEach((child) => wrap.appendChild(renderNodeReadOnly(child, doc, depth + 1)));
    return wrap;
  }

  function renderCover(doc, template, parteLabel) {
    const cover = el("div", { class: "print-cover" });
    cover.appendChild(el("p", { class: "print-cover-brand", text: "FERROVIENORD" }));
    cover.appendChild(el("h1", { text: "REGISTRO DELLE DISPOSIZIONI DI SERVIZIO" }));
    const isPosto = template.id === "posto_servizio";
    cover.appendChild(
      el("h2", {
        text: `${isPosto ? "POSTO DI SERVIZIO" : "LOCALITÀ DI SERVIZIO"}: ${(doc.meta.denominazione || "").toUpperCase()}`,
      })
    );
    cover.appendChild(el("p", { class: "print-cover-mod", text: `Mod. 0308 — ${parteLabel}` }));
    const stamp = el("table", { class: "print-stamp" }, [
      el("tr", {}, [
        el("td", { text: "Edizione: " + textOrDash(doc.meta.edizione) }),
        el("td", { text: "Aggiornamento n° " + textOrDash(doc.meta.aggiornamento) }),
        el("td", { text: "Entrata in vigore: " + textOrDash(doc.meta.data_entrata_vigore) }),
        el("td", { text: "Firma: —" }),
      ]),
    ]);
    cover.appendChild(stamp);
    return cover;
  }

  function renderGeneralita(doc, template) {
    const wrap = el("div", { class: "print-generalita" });
    wrap.appendChild(el("h2", { text: "GENERALITÀ" }));
    const table = el("table", { class: "print-table print-meta" });
    template.metaFields.forEach((f) => {
      table.appendChild(
        el("tr", {}, [el("td", { class: "meta-label", text: f.label }), el("td", { text: textOrDash(doc.meta[f.key]) })])
      );
    });
    wrap.appendChild(table);
    return wrap;
  }

  function renderPartTree(tree, doc) {
    const wrap = el("div", { class: "print-part" });
    tree.forEach((node) => wrap.appendChild(renderNodeReadOnly(node, doc, 0)));
    return wrap;
  }

  function renderPrintable(container, template, doc) {
    container.innerHTML = "";
    container.appendChild(renderCover(doc, template, "Parte Prima" + (template.hasPartSeconda ? " e Parte Seconda" : "")));
    container.appendChild(renderGeneralita(doc, template));
    container.appendChild(el("h1", { class: "print-part-title", text: "PARTE PRIMA" }));
    container.appendChild(renderPartTree(template.parteUno, doc));
    if (template.hasPartSeconda && template.parteDue) {
      container.appendChild(el("div", { class: "print-page-break" }));
      container.appendChild(el("h1", { class: "print-part-title", text: "PARTE SECONDA" }));
      container.appendChild(renderPartTree(template.parteDue, doc));
    }
  }

  global.RDS = global.RDS || {};
  global.RDS.print = { renderPrintable };
})(window);

// App RDS Mod. 0308 — bootstrap, elenco documenti, editor, stampa, import/export.
(function () {
  "use strict";

  const fallbackNotice = document.getElementById("fallback-notice");
  if (fallbackNotice) fallbackNotice.remove();

  const { TEMPLATES } = window.RDS;
  const storage = window.RDS.storage;
  const renderApi = window.RDS.render;
  const printApi = window.RDS.print;
  const el = renderApi.el;

  const viewList = document.getElementById("view-list");
  const viewEditor = document.getElementById("view-editor");
  const topbarActions = document.getElementById("topbar-actions");
  const editorToc = document.getElementById("editor-toc");
  const editorMeta = document.getElementById("editor-meta");
  const editorParte1 = document.getElementById("editor-parte1");
  const editorParte2 = document.getElementById("editor-parte2");
  const editorParte2Wrap = document.getElementById("editor-parte2-wrap");
  const printArea = document.getElementById("print-area");
  const importInput = document.getElementById("import-input");
  const importDocxInput = document.getElementById("import-docx-input");
  const docxDialog = document.getElementById("docx-import-dialog");
  const docxTemplateSelect = document.getElementById("docx-import-template");
  const docxFilenameLabel = document.getElementById("docx-import-filename");
  const docxCancelBtn = document.getElementById("docx-import-cancel");
  const docxConfirmBtn = document.getElementById("docx-import-confirm");
  const docxReportDialog = document.getElementById("docx-report-dialog");
  const docxReportText = document.getElementById("docx-report-text");
  const docxReportCopyBtn = document.getElementById("docx-report-copy");
  const docxReportCloseBtn = document.getElementById("docx-report-close");
  let pendingDocxFile = null;
  let pendingOpenAfterReport = null;

  let currentDoc = null;
  let currentTemplate = null;
  let saveTimer = null;

  function fmtDate(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString("it-IT");
    } catch (e) {
      return iso;
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (currentDoc) storage.upsert(currentDoc);
    }, 400);
  }

  function setTopbarActions(buttons) {
    topbarActions.innerHTML = "";
    buttons.forEach((b) => topbarActions.appendChild(b));
  }

  function button(label, cls, onClick) {
    const b = el("button", { type: "button", class: cls || "btn-secondary", text: label });
    b.addEventListener("click", onClick);
    return b;
  }

  // ---------------------------------------------------------------- LISTA
  function renderList() {
    currentDoc = null;
    currentTemplate = null;
    viewEditor.hidden = true;
    viewList.hidden = false;
    viewList.innerHTML = "";

    setTopbarActions([
      button("Importa da Word (.docx)", "btn-primary", () => importDocxInput.click()),
      button("Importa JSON", "btn-secondary", () => importInput.click()),
    ]);

    const createPanel = el("div", { class: "create-panel" });
    const templateSelect = el("select", { id: "new-template" });
    Object.values(TEMPLATES).forEach((t) => {
      templateSelect.appendChild(el("option", { value: t.id, text: t.label }));
    });
    const nameInput = el("input", { type: "text", placeholder: "Denominazione (es. Novate Milanese)" });
    const createBtn = button("Crea nuovo RDS", "btn-primary", () => {
      const doc = storage.createBlank(templateSelect.value, nameInput.value.trim());
      storage.upsert(doc);
      openEditor(doc.id);
    });
    createPanel.appendChild(el("h2", { text: "Nuovo documento" }));
    const row = el("div", { class: "create-row" }, [templateSelect, nameInput, createBtn]);
    createPanel.appendChild(row);
    viewList.appendChild(createPanel);

    const docs = storage.loadAll().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const listWrap = el("div", { class: "doc-grid" });
    if (!docs.length) {
      listWrap.appendChild(el("p", { class: "empty-state", text: "Nessun RDS salvato. Creane uno nuovo oppure importa un file JSON esportato in precedenza." }));
    }
    docs.forEach((doc) => {
      const tmpl = TEMPLATES[doc.templateId] || TEMPLATES.stazione;
      const isUnverified = doc.reviewStatus === "da_verificare";
      const card = el("article", { class: "doc-card" + (isUnverified ? " doc-card-unverified" : "") });
      const titleRow = el("div", { class: "doc-card-title-row" }, [
        el("h3", { text: doc.meta.denominazione || "(senza nome)" }),
        el("span", {
          class: "review-badge " + (isUnverified ? "review-badge-warn" : "review-badge-ok"),
          text: isUnverified ? "Da verificare" : "Verificato",
        }),
      ]);
      card.appendChild(titleRow);
      card.appendChild(el("p", { class: "doc-card-meta", text: tmpl.label }));
      card.appendChild(
        el("p", { class: "doc-card-meta", text: `Ed. ${doc.meta.edizione || "00"} · Agg. ${doc.meta.aggiornamento || "00"} · Modificato: ${fmtDate(doc.updatedAt)}` })
      );
      const actions = el("div", { class: "doc-card-actions" }, [
        button("Apri", "btn-primary", () => openEditor(doc.id)),
        isUnverified
          ? button("Segna come verificato", "btn-secondary", () => {
              doc.reviewStatus = "verificato";
              storage.upsert(doc);
              renderList();
            })
          : null,
        button("Duplica", "btn-secondary", () => {
          const copy = JSON.parse(JSON.stringify(doc));
          copy.id = storage.uid();
          copy.meta.denominazione = (copy.meta.denominazione || "") + " (copia)";
          storage.upsert(copy);
          renderList();
        }),
        button("Esporta JSON", "btn-secondary", () => storage.downloadJSON(doc)),
        button("Elimina", "btn-danger", () => {
          if (window.confirm(`Eliminare definitivamente il RDS "${doc.meta.denominazione}"?`)) {
            storage.remove(doc.id);
            renderList();
          }
        }),
      ]);
      card.appendChild(actions);
      listWrap.appendChild(card);
    });
    viewList.appendChild(listWrap);
  }

  // --------------------------------------------------------------- EDITOR
  function buildToc() {
    editorToc.innerHTML = "";
    editorToc.appendChild(el("h4", { text: "Indice" }));
    const list = el("nav", { class: "toc-nav" });

    function addLink(node, depth) {
      const a = el("a", { href: "#sec-" + node.id, text: `${node.id}. ${node.title}`, class: "toc-link depth-" + depth });
      list.appendChild(a);
      if (node.kind === "group") {
        node.children.forEach((c) => addLink(c, depth + 1));
      }
    }

    list.appendChild(el("p", { class: "toc-section-label", text: "Parte Prima" }));
    currentTemplate.parteUno.forEach((n) => addLink(n, 0));
    if (currentTemplate.hasPartSeconda) {
      list.appendChild(el("p", { class: "toc-section-label", text: "Parte Seconda" }));
      currentTemplate.parteDue.forEach((n) => addLink(n, 0));
    }
    editorToc.appendChild(list);
  }

  function onAnyChange() {
    scheduleSave();
  }

  function openEditor(id) {
    currentDoc = storage.get(id);
    if (!currentDoc) return renderList();
    currentTemplate = TEMPLATES[currentDoc.templateId] || TEMPLATES.stazione;

    viewList.hidden = true;
    viewEditor.hidden = false;

    setTopbarActions([
      button("← Elenco", "btn-secondary", () => {
        if (currentDoc) storage.upsert(currentDoc);
        renderList();
      }),
      button("Stampa / PDF", "btn-secondary", printCurrent),
      button("Esporta JSON", "btn-secondary", () => storage.downloadJSON(currentDoc)),
      button("Salva", "btn-primary", () => {
        storage.upsert(currentDoc);
        flashSaved();
      }),
    ]);

    editorMeta.innerHTML = "";
    editorMeta.appendChild(el("h2", { text: "Generalità" }));
    const metaGrid = el("div", { class: "meta-grid" });
    editorMeta.appendChild(metaGrid);
    renderApi.buildMetaEditor(metaGrid, currentTemplate.metaFields, currentDoc, onAnyChange);

    const stampGrid = el("div", { class: "meta-grid stamp-grid" });
    [
      { key: "edizione", type: "text", label: "Edizione" },
      { key: "aggiornamento", type: "text", label: "Aggiornamento n°" },
      { key: "data_entrata_vigore", type: "text", label: "Entrata in vigore (gg/mm/aaaa)" },
    ].forEach((f) => {
      stampGrid.appendChild(
        renderSimpleStampField(f, currentDoc.meta[f.key] || "", (v) => {
          currentDoc.meta[f.key] = v;
          onAnyChange();
        })
      );
    });
    editorMeta.appendChild(stampGrid);

    renderApi.buildEditor(editorParte1, currentTemplate.parteUno, currentDoc, onAnyChange);
    if (currentTemplate.hasPartSeconda) {
      editorParte2Wrap.hidden = false;
      renderApi.buildEditor(editorParte2, currentTemplate.parteDue, currentDoc, onAnyChange);
    } else {
      editorParte2Wrap.hidden = true;
      editorParte2.innerHTML = "";
    }

    buildToc();
    window.scrollTo(0, 0);
  }

  function renderSimpleStampField(field, value, onChange) {
    const input = el("input", { type: "text" });
    input.value = value;
    input.addEventListener("input", () => onChange(input.value));
    return el("div", { class: "field field-text" }, [el("label", { text: field.label }), input]);
  }

  function flashSaved() {
    const note = el("span", { class: "save-flash", text: "Salvato" });
    topbarActions.appendChild(note);
    setTimeout(() => note.remove(), 1200);
  }

  function printCurrent() {
    if (!currentDoc || !currentTemplate) return;
    storage.upsert(currentDoc);
    printApi.renderPrintable(printArea, currentTemplate, currentDoc);
    document.body.classList.add("printing");
    window.print();
    setTimeout(() => document.body.classList.remove("printing"), 300);
  }

  // ------------------------------------------------------------ IMPORT DOCX
  importDocxInput.addEventListener("change", () => {
    const file = importDocxInput.files[0];
    if (!file) return;
    pendingDocxFile = file;
    docxTemplateSelect.innerHTML = "";
    Object.values(TEMPLATES).forEach((t) => {
      docxTemplateSelect.appendChild(el("option", { value: t.id, text: t.label }));
    });
    docxFilenameLabel.textContent = "File: " + file.name;
    docxDialog.hidden = false;
  });

  function closeDocxDialog() {
    docxDialog.hidden = true;
    pendingDocxFile = null;
    importDocxInput.value = "";
  }

  docxCancelBtn.addEventListener("click", closeDocxDialog);

  docxConfirmBtn.addEventListener("click", async () => {
    if (!pendingDocxFile) return;
    const file = pendingDocxFile;
    const templateId = docxTemplateSelect.value;
    docxConfirmBtn.disabled = true;
    docxConfirmBtn.textContent = "Importazione…";
    try {
      const template = TEMPLATES[templateId] || TEMPLATES.stazione;
      const { doc, warnings } = await window.RDS.docximport.importDocx(file, templateId);
      if (!doc.meta.denominazione) {
        doc.meta.denominazione = file.name.replace(/\.docx$/i, "");
      }
      doc.reviewStatus = "da_verificare";
      storage.upsert(doc);
      closeDocxDialog();
      const report = window.RDS.docximport.buildReport(doc, template, warnings, file.name);
      docxReportText.value = report;
      pendingOpenAfterReport = doc.id;
      docxReportDialog.hidden = false;
    } catch (err) {
      console.error(err);
      window.alert("Impossibile importare il file: " + err.message);
    } finally {
      docxConfirmBtn.disabled = false;
      docxConfirmBtn.textContent = "Importa";
    }
  });

  docxReportCopyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(docxReportText.value);
      docxReportCopyBtn.textContent = "Copiato ✓";
      setTimeout(() => (docxReportCopyBtn.textContent = "Copia negli appunti"), 1500);
    } catch (err) {
      docxReportText.select();
      window.alert("Copia automatica non disponibile: seleziona il testo e premi Ctrl+C.");
    }
  });

  docxReportCloseBtn.addEventListener("click", () => {
    docxReportDialog.hidden = true;
    const id = pendingOpenAfterReport;
    pendingOpenAfterReport = null;
    if (id) openEditor(id);
  });

  // ------------------------------------------------------------ IMPORT
  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const data = await storage.readJSONFile(file);
      if (!data || !data.templateId || !TEMPLATES[data.templateId]) {
        window.alert("Il file selezionato non sembra un RDS valido esportato da questa applicazione.");
        return;
      }
      if (!data.id) data.id = storage.uid();
      storage.upsert(data);
      renderList();
    } catch (err) {
      window.alert("Impossibile leggere il file JSON selezionato.");
      console.error(err);
    } finally {
      importInput.value = "";
    }
  });

  window.addEventListener("beforeprint", () => {
    if (currentDoc && currentTemplate) printApi.renderPrintable(printArea, currentTemplate, currentDoc);
  });

  renderList();
})();

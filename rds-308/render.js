// Renderer generico del form di editing, guidato dallo schema (schema.js).
(function (global) {
  "use strict";

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach((c) => c && node.appendChild(c));
    return node;
  }

  function walkLeaves(nodes, cb, path) {
    (nodes || []).forEach((node) => {
      if (node.kind === "leaf") {
        cb(node, path || []);
      } else if (node.kind === "group") {
        walkLeaves(node.children, cb, (path || []).concat(node));
      }
    });
  }

  function flattenAll(nodes, out) {
    out = out || [];
    (nodes || []).forEach((node) => {
      out.push(node);
      if (node.kind === "group") flattenAll(node.children, out);
    });
    return out;
  }

  function ensureSection(doc, id) {
    if (!doc.sections[id]) {
      doc.sections[id] = { perMemoria: false, values: {} };
    }
    if (!doc.sections[id].values) doc.sections[id].values = {};
    return doc.sections[id];
  }

  function defaultValueFor(field) {
    if (field.type === "table") return [];
    if (field.type === "matrix") {
      return { rows: (field.defaultRows || []).slice(), cols: (field.defaultCols || []).slice(), cells: {} };
    }
    if (field.type === "systemlist") {
      return (field.defaultTitles || []).map((t) => ({ titolo: t, testo: "" }));
    }
    return "";
  }

  function ensureFieldValue(section, field) {
    if (!(field.key in section.values) || section.values[field.key] === undefined || section.values[field.key] === null) {
      section.values[field.key] = defaultValueFor(field);
    }
    return section.values[field.key];
  }

  // ---- Widget: campo semplice -------------------------------------------
  function renderSimpleField(field, value, onChange) {
    const id = "f_" + Math.random().toString(36).slice(2, 9);
    let input;
    if (field.type === "textarea") {
      input = el("textarea", { id, rows: "3" });
      input.value = value || "";
      input.addEventListener("input", () => onChange(input.value));
    } else if (field.type === "select") {
      input = el("select", { id });
      (field.options || []).forEach((opt) => {
        const optEl = el("option", { value: opt, text: opt || "—" });
        if (opt === value) optEl.selected = true;
        input.appendChild(optEl);
      });
      input.addEventListener("change", () => onChange(input.value));
    } else {
      input = el("input", { id, type: "text" });
      input.value = value || "";
      input.addEventListener("input", () => onChange(input.value));
    }
    const wrap = el("div", { class: "field field-" + field.type }, [
      el("label", { for: id, text: field.label }),
      input,
    ]);
    return wrap;
  }

  // ---- Widget: tabella ----------------------------------------------------
  function renderTableField(field, rows, onChange) {
    const table = el("table", { class: "rds-table" });
    const thead = el("thead", {}, [
      el("tr", {}, field.columns.map((c) => el("th", { text: c.label, style: c.width ? `width:${c.width}` : "" })).concat([el("th", { class: "col-actions", text: "" })])),
    ]);
    const tbody = el("tbody");

    function renderRows() {
      tbody.innerHTML = "";
      rows.forEach((row, idx) => {
        const tr = el("tr");
        field.columns.forEach((c) => {
          let cell;
          if (c.type === "select") {
            cell = el("select");
            (c.options || []).forEach((opt) => {
              const optEl = el("option", { value: opt, text: opt || "—" });
              if (opt === row[c.key]) optEl.selected = true;
              cell.appendChild(optEl);
            });
            cell.addEventListener("change", () => {
              row[c.key] = cell.value;
              onChange(rows);
            });
          } else {
            cell = el("input", { type: "text" });
            cell.value = row[c.key] || "";
            cell.addEventListener("input", () => {
              row[c.key] = cell.value;
              onChange(rows);
            });
          }
          tr.appendChild(el("td", {}, [cell]));
        });
        const delBtn = el("button", { type: "button", class: "btn-icon", title: "Rimuovi riga", text: "✕" });
        delBtn.addEventListener("click", () => {
          rows.splice(idx, 1);
          onChange(rows);
          renderRows();
        });
        tr.appendChild(el("td", { class: "col-actions" }, [delBtn]));
        tbody.appendChild(tr);
      });
    }
    renderRows();
    table.appendChild(thead);
    table.appendChild(tbody);

    const addBtn = el("button", { type: "button", class: "btn-secondary", text: field.addRowLabel || "Aggiungi riga" });
    addBtn.addEventListener("click", () => {
      const row = {};
      field.columns.forEach((c) => (row[c.key] = ""));
      rows.push(row);
      onChange(rows);
      renderRows();
    });

    return el("div", { class: "field field-table" }, [
      el("label", { text: field.label }),
      el("div", { class: "table-scroll" }, [table]),
      addBtn,
    ]);
  }

  // ---- Widget: matrice funzioni x attività --------------------------------
  function renderMatrixField(field, data, onChange) {
    if (!data.rows) data.rows = [];
    if (!data.cols) data.cols = [];
    if (!data.cells) data.cells = {};

    const container = el("div", { class: "field field-matrix" }, [el("label", { text: field.label })]);
    const tableWrap = el("div", { class: "table-scroll" });
    container.appendChild(tableWrap);

    function cellKey(r, c) {
      return r + "|" + c;
    }

    function renderTable() {
      tableWrap.innerHTML = "";
      const table = el("table", { class: "rds-table rds-matrix" });
      const headRow = el("tr", {}, [el("th", { text: "Attività \\ Agente" })]);
      data.cols.forEach((col, ci) => {
        const th = el("th");
        const input = el("input", { type: "text" });
        input.value = col;
        input.addEventListener("input", () => {
          data.cols[ci] = input.value;
          onChange(data);
        });
        const delColBtn = el("button", { type: "button", class: "btn-icon", title: "Rimuovi colonna", text: "✕" });
        delColBtn.addEventListener("click", () => {
          data.cols.splice(ci, 1);
          onChange(data);
          renderTable();
        });
        th.appendChild(input);
        th.appendChild(delColBtn);
        headRow.appendChild(th);
      });
      headRow.appendChild(el("th"));
      const thead = el("thead", {}, [headRow]);
      const tbody = el("tbody");

      data.rows.forEach((row, ri) => {
        const tr = el("tr");
        const rowLabelInput = el("input", { type: "text" });
        rowLabelInput.value = row;
        rowLabelInput.addEventListener("input", () => {
          const oldKeyPrefix = row + "|";
          data.rows[ri] = rowLabelInput.value;
          // aggiorna le chiavi delle celle associate a questa riga
          Object.keys(data.cells).forEach((k) => {
            if (k.startsWith(oldKeyPrefix)) {
              const suffix = k.slice(oldKeyPrefix.length);
              data.cells[rowLabelInput.value + "|" + suffix] = data.cells[k];
              delete data.cells[k];
            }
          });
          row = rowLabelInput.value;
          onChange(data);
        });
        tr.appendChild(el("td", { class: "row-label" }, [rowLabelInput]));
        data.cols.forEach((col) => {
          const td = el("td", { class: "cell-check" });
          const checkbox = el("input", { type: "checkbox" });
          checkbox.checked = !!data.cells[cellKey(row, col)];
          checkbox.addEventListener("change", () => {
            data.cells[cellKey(row, col)] = checkbox.checked;
            onChange(data);
          });
          td.appendChild(checkbox);
          tr.appendChild(td);
        });
        const delRowBtn = el("button", { type: "button", class: "btn-icon", title: "Rimuovi riga", text: "✕" });
        delRowBtn.addEventListener("click", () => {
          data.rows.splice(ri, 1);
          onChange(data);
          renderTable();
        });
        tr.appendChild(el("td", { class: "col-actions" }, [delRowBtn]));
        tbody.appendChild(tr);
      });

      table.appendChild(thead);
      table.appendChild(tbody);
      tableWrap.appendChild(table);
    }
    renderTable();

    const addRowBtn = el("button", { type: "button", class: "btn-secondary", text: "Aggiungi attività" });
    addRowBtn.addEventListener("click", () => {
      data.rows.push("Nuova attività");
      onChange(data);
      renderTable();
    });
    const addColBtn = el("button", { type: "button", class: "btn-secondary", text: "Aggiungi agente" });
    addColBtn.addEventListener("click", () => {
      data.cols.push("Agente " + (data.cols.length + 1));
      onChange(data);
      renderTable();
    });
    container.appendChild(el("div", { class: "matrix-actions" }, [addRowBtn, addColBtn]));
    return container;
  }

  // ---- Widget: elenco di sistemi (titolo + descrizione) -------------------
  function renderSystemListField(field, items, onChange) {
    const container = el("div", { class: "field field-systemlist" }, [el("label", { text: field.label })]);
    const list = el("div", { class: "system-list" });
    container.appendChild(list);

    function renderList() {
      list.innerHTML = "";
      items.forEach((item, idx) => {
        const titleInput = el("input", { type: "text", class: "system-title" });
        titleInput.value = item.titolo || "";
        titleInput.placeholder = "Nome sistema/attrezzatura";
        titleInput.addEventListener("input", () => {
          item.titolo = titleInput.value;
          onChange(items);
        });
        const textInput = el("textarea", { rows: "2", class: "system-text" });
        textInput.value = item.testo || "";
        textInput.placeholder = "Descrizione, funzionamento o rimando alla manualistica";
        textInput.addEventListener("input", () => {
          item.testo = textInput.value;
          onChange(items);
        });
        const delBtn = el("button", { type: "button", class: "btn-icon", title: "Rimuovi", text: "✕" });
        delBtn.addEventListener("click", () => {
          items.splice(idx, 1);
          onChange(items);
          renderList();
        });
        const row = el("div", { class: "system-item" }, [
          el("div", { class: "system-item-head" }, [titleInput, delBtn]),
          textInput,
        ]);
        list.appendChild(row);
      });
    }
    renderList();

    const addBtn = el("button", { type: "button", class: "btn-secondary", text: field.addRowLabel || "Aggiungi voce" });
    addBtn.addEventListener("click", () => {
      items.push({ titolo: "", testo: "" });
      onChange(items);
      renderList();
    });
    container.appendChild(addBtn);
    return container;
  }

  function renderField(field, section, onAnyChange) {
    const value = ensureFieldValue(section, field);
    const commit = (newVal) => {
      section.values[field.key] = newVal;
      onAnyChange();
    };
    if (field.type === "table") return renderTableField(field, value, commit);
    if (field.type === "matrix") return renderMatrixField(field, value, commit);
    if (field.type === "systemlist") return renderSystemListField(field, value, commit);
    return renderSimpleField(field, value, commit);
  }

  function renderLeaf(node, doc, onAnyChange) {
    const section = ensureSection(doc, node.id);
    const wrap = el("section", { class: "leaf-section", id: "sec-" + node.id });
    const header = el("div", { class: "leaf-header" }, [
      el("h3", { text: `${node.id}. ${node.title}` }),
    ]);

    const fieldsContainer = el("div", { class: "leaf-fields" });

    function renderFields() {
      fieldsContainer.innerHTML = "";
      if (section.perMemoria) {
        fieldsContainer.appendChild(el("p", { class: "per-memoria-note", text: "Per memoria." }));
        return;
      }
      node.fields.forEach((f) => fieldsContainer.appendChild(renderField(f, section, onAnyChange)));
    }

    if (!node.noPerMemoria) {
      const checkboxId = "pm_" + node.id;
      const checkbox = el("input", { type: "checkbox", id: checkboxId });
      checkbox.checked = !!section.perMemoria;
      checkbox.addEventListener("change", () => {
        section.perMemoria = checkbox.checked;
        onAnyChange();
        renderFields();
      });
      header.appendChild(
        el("label", { class: "per-memoria-toggle", for: checkboxId }, [checkbox, document.createTextNode(" Non applicabile (Per memoria)")])
      );
    }

    renderFields();
    wrap.appendChild(header);
    wrap.appendChild(fieldsContainer);
    return wrap;
  }

  function renderGroup(node, doc, onAnyChange, depth) {
    const wrap = el("div", { class: "group-section depth-" + depth, id: "sec-" + node.id });
    const tag = depth === 0 ? "h2" : "h4";
    wrap.appendChild(el(tag, { class: "group-title", text: `${node.id}. ${node.title}` }));
    node.children.forEach((child) => {
      wrap.appendChild(renderNode(child, doc, onAnyChange, depth + 1));
    });
    return wrap;
  }

  function renderNode(node, doc, onAnyChange, depth) {
    if (node.kind === "leaf") return renderLeaf(node, doc, onAnyChange);
    return renderGroup(node, doc, onAnyChange, depth || 0);
  }

  function buildEditor(container, tree, doc, onAnyChange) {
    container.innerHTML = "";
    tree.forEach((node) => container.appendChild(renderNode(node, doc, onAnyChange, 0)));
  }

  function buildMetaEditor(container, metaFields, doc, onAnyChange) {
    container.innerHTML = "";
    metaFields.forEach((field) => {
      const value = doc.meta[field.key] || "";
      const wrap = renderSimpleField(field, value, (v) => {
        doc.meta[field.key] = v;
        onAnyChange();
      });
      container.appendChild(wrap);
    });
  }

  global.RDS = global.RDS || {};
  global.RDS.render = {
    walkLeaves,
    flattenAll,
    ensureSection,
    ensureFieldValue,
    buildEditor,
    buildMetaEditor,
    el,
  };
})(window);

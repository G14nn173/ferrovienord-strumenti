// Persistenza locale dei documenti RDS (localStorage) + import/export JSON.
(function (global) {
  "use strict";

  const STORAGE_KEY = "rds308.documenti.v1";

  function uid() {
    return "rds_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function loadAll() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error("Impossibile leggere i documenti salvati", err);
      return [];
    }
  }

  function saveAll(list) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (err) {
      console.error("Impossibile salvare i documenti", err);
      return false;
    }
  }

  function upsert(doc) {
    const list = loadAll();
    doc.updatedAt = new Date().toISOString();
    const idx = list.findIndex((d) => d.id === doc.id);
    if (idx >= 0) {
      list[idx] = doc;
    } else {
      list.push(doc);
    }
    saveAll(list);
    return doc;
  }

  function remove(id) {
    const list = loadAll().filter((d) => d.id !== id);
    saveAll(list);
  }

  function get(id) {
    return loadAll().find((d) => d.id === id) || null;
  }

  function createBlank(templateId, denominazione) {
    return {
      id: uid(),
      templateId,
      meta: {
        denominazione: denominazione || "",
        classificazione: "",
        struttura_giurisdizione: "",
        orario_presenziamento: "",
        caratteristiche_tratta: "",
        sistema_dirigenza: "",
        altre_particolarita: "",
        edizione: "00",
        aggiornamento: "00",
        data_entrata_vigore: "",
      },
      sections: {},
      reviewStatus: "verificato",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function downloadJSON(doc) {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const nome = (doc.meta && doc.meta.denominazione) || "rds";
    a.href = url;
    a.download = `RDS_${nome.replace(/[^a-z0-9]+/gi, "_")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function readJSONFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  global.RDS = global.RDS || {};
  global.RDS.storage = { loadAll, saveAll, upsert, remove, get, createBlank, downloadJSON, readJSONFile, uid };
})(window);

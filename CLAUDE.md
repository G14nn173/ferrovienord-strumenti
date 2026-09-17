# Istruzioni permanenti per questo repository

Questo repository contiene più applicazioni web indipendenti (vedi
`README.md`). Le regole qui sotto valgono per qualsiasi sviluppo, in
qualunque cartella del repo, a prescindere da cosa sto facendo in quel
momento.

## Regola fissa: un `AGENTS.md` per ogni app, sempre aggiornato

Ogni cartella applicativa (`portable/`, `bordo-treno/`, `rds-308/`, e
qualunque nuova app futura) **deve avere un file `AGENTS.md`** al suo interno
che spieghi, per chi riprende lo sviluppo — umano o un altro agente IA
(Codex, Copilot, Gemini, un'altra sessione Claude...) — senza aver visto la
conversazione originale:

- a cosa serve l'app e per chi (contesto reale, non solo tecnico);
- come è strutturata (ruolo dei file principali);
- le decisioni di design prese e **perché** (non solo il "cosa", il "perché":
  altrimenti chi arriva dopo rifà le stesse indagini o disfa scelte corrette
  pensando siano refusi);
- i meccanismi non ovvi o scoperti con fatica (bug non intuitivi, comportamenti
  di browser/OS sorprendenti, euristiche del parsing, ecc.);
- i limiti noti e cosa NON è ancora stato fatto;
- come si verifica che funzioni (se non c'è una suite di test automatici,
  dillo esplicitamente e spiega come è stato verificato finora).

**Quando aggiornarlo**: nella stessa sessione/turno in cui si fa una modifica
sostanziale al codice di quell'app (nuova funzionalità, cambio di
architettura, bug non banale risolto, nuovo limite scoperto) — non a fine
lavoro, non "quando capita". Un `AGENTS.md` disallineato dal codice è peggio
di nessun `AGENTS.md`, perché sembra autorevole ma mente.

**Non serve aggiornarlo per**: refactor cosmetici, fix di battitura, modifiche
che non cambiano comportamento o decisioni.

**Se un'app non ha ancora `AGENTS.md`** (es. `portable/`, `bordo-treno/` al
momento in cui scrivo) e ci lavoro sopra, ne creo uno prima di considerare il
lavoro finito, anche se non era quello il compito richiesto — è debito da non
lasciare accumulare.

## Perché questa regola esiste

L'utente lavora con più agenti IA diversi nello stesso repo nel tempo (non
solo Claude Code). La cronologia di una conversazione con un agente non è
visibile a un agente diverso o a una sessione futura: se il contesto vive solo
lì, si perde. `AGENTS.md` per-app è il modo per non ripetere le stesse
scoperte né disfare le stesse decisioni.

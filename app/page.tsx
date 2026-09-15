"use client";

import {
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import networkJson from "./network-data.json";

type ComponentId = "ovest" | "est";
type Area = "all" | ComponentId;
type Mode = "all" | "passenger" | "interchange";
type Labels = "major" | "all" | "none";
type Node = {
  id: number;
  name: string;
  shortName: string | null;
  code: string | null;
  mirCode: string | null;
  sigla: string | null;
  x: number;
  y: number;
  altitude: number | null;
  owner: number;
  component: ComponentId;
  passenger: boolean;
  freight: boolean;
  traffic: string;
  typeCode: number;
  border: boolean;
  major: boolean;
  activeFrom: string | null;
};
type Edge = {
  id: number;
  from: number;
  to: number;
  lengthMeters: number;
  routeCode: string | null;
  typeCode: number;
  blockCode: number;
  tractionCode: number;
  operationCode: number;
  controlCode: number | null;
  massCategory: string | null;
  traffic: string;
  activeFrom: string | null;
};
type Data = {
  meta: {
    displayedLocalities: number;
    displayedSections: number;
    networkLengthKm: number;
  };
  nodes: Node[];
  edges: Edge[];
};
type Selection = { type: "node" | "edge"; id: number };
type View = { x: number; y: number; w: number; h: number };

const data = networkJson as unknown as Data;
const W = 1200;
const H = 760;
const PAD = 62;
const RATIO = W / H;
const FULL: View = { x: 0, y: 0, w: W, h: H };
const COMPONENTS = {
  ovest: {
    label: "Rete Ovest",
    detail: "Milano · Varese · Como · Novara",
    color: "#16c8f4",
  },
  est: {
    label: "Rete Est",
    detail: "Brescia · Iseo · Edolo",
    color: "#b8ed4a",
  },
} as const;

const nodes = new Map(data.nodes.map((node) => [node.id, node]));
const edges = new Map(data.edges.map((edge) => [edge.id, edge]));
const xs = data.nodes.map((node) => node.x);
const ys = data.nodes.map((node) => node.y);
const bounds = {
  minX: Math.min(...xs),
  maxX: Math.max(...xs),
  minY: Math.min(...ys),
  maxY: Math.max(...ys),
};
const position = (node: Node) => ({
  x:
    PAD +
    ((node.x - bounds.minX) / (bounds.maxX - bounds.minX)) * (W - PAD * 2),
  y:
    H -
    PAD -
    ((node.y - bounds.minY) / (bounds.maxY - bounds.minY)) * (H - PAD * 2),
});
const positions = new Map(data.nodes.map((node) => [node.id, position(node)]));
const degree = new Map<number, number>();
for (const edge of data.edges) {
  degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
  degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
}
const subscribeToHydration = () => () => {};

const km = (meters: number) =>
  new Intl.NumberFormat("it-IT", {
    maximumFractionDigits: 1,
    minimumFractionDigits: meters < 10000 ? 1 : 0,
  }).format(meters / 1000);
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("it-IT", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(`${value}T12:00:00`))
    : "Non indicata";

function fit(targets: Node[]): View {
  if (!targets.length) return FULL;
  const pts = targets.map((node) => positions.get(node.id)!);
  const minX = Math.min(...pts.map((point) => point.x));
  const maxX = Math.max(...pts.map((point) => point.x));
  const minY = Math.min(...pts.map((point) => point.y));
  const maxY = Math.max(...pts.map((point) => point.y));
  let w = Math.max((maxX - minX) * 1.22, 320);
  let h = Math.max((maxY - minY) * 1.22, 250);
  if (w / h > RATIO) h = w / RATIO;
  else w = h * RATIO;
  w = Math.min(w, W);
  h = Math.min(h, H);
  return {
    x: Math.max(0, Math.min((minX + maxX - w) / 2, W - w)),
    y: Math.max(0, Math.min((minY + maxY - h) / 2, H - h)),
    w,
    h,
  };
}

function Logo() {
  return (
    <div className="logo" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}

function NetworkApp() {
  const initial =
    data.nodes.find((node) => node.name === "MILANO CADORNA") ?? data.nodes[0];
  const [area, setArea] = useState<Area>("all");
  const [mode, setMode] = useState<Mode>("all");
  const [labels, setLabels] = useState<Labels>("major");
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection>({
    type: "node",
    id: initial.id,
  });
  const [view, setView] = useState<View>(FULL);
  const pan = useRef<{
    id: number;
    x: number;
    y: number;
    view: View;
  } | null>(null);
  const zoom = W / view.w;

  const areaNodes = useMemo(
    () =>
      data.nodes.filter(
        (node) => area === "all" || node.component === area,
      ),
    [area],
  );
  const visibleNodes = useMemo(
    () =>
      areaNodes.filter((node) =>
        mode === "passenger"
          ? node.passenger
          : mode === "interchange"
            ? node.border
            : true,
      ),
    [areaNodes, mode],
  );
  const areaIds = useMemo(
    () => new Set(areaNodes.map((node) => node.id)),
    [areaNodes],
  );
  const visibleIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes],
  );
  const visibleEdges = useMemo(
    () =>
      data.edges.filter((edge) => {
        if (!areaIds.has(edge.from) || !areaIds.has(edge.to)) return false;
        return mode !== "passenger" || (visibleIds.has(edge.from) && visibleIds.has(edge.to));
      }),
    [areaIds, mode, visibleIds],
  );
  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("it");
    if (!q) return [];
    return data.nodes
      .filter((node) =>
        [node.name, node.sigla, node.code, node.mirCode]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase("it").includes(q)),
      )
      .sort(
        (a, b) =>
          Number(b.name.toLocaleLowerCase("it").startsWith(q)) -
            Number(a.name.toLocaleLowerCase("it").startsWith(q)) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 7);
  }, [query]);

  const selectedNode =
    selection.type === "node" ? nodes.get(selection.id) ?? null : null;
  const selectedEdge =
    selection.type === "edge" ? edges.get(selection.id) ?? null : null;
  const connections = useMemo(() => {
    if (!selectedNode) return [];
    const grouped = new Map<
      number,
      { edge: Edge; node: Node; count: number; min: number; max: number }
    >();
    for (const edge of data.edges) {
      if (edge.from !== selectedNode.id && edge.to !== selectedNode.id) continue;
      const otherId = edge.from === selectedNode.id ? edge.to : edge.from;
      const current = grouped.get(otherId);
      if (current) {
        current.count += 1;
        current.min = Math.min(current.min, edge.lengthMeters);
        current.max = Math.max(current.max, edge.lengthMeters);
      } else {
        grouped.set(otherId, {
          edge,
          node: nodes.get(otherId)!,
          count: 1,
          min: edge.lengthMeters,
          max: edge.lengthMeters,
        });
      }
    }
    return [...grouped.values()].sort((a, b) =>
      a.node.name.localeCompare(b.node.name),
    );
  }, [selectedNode]);

  const chooseArea = (next: Area) => {
    setArea(next);
    if (next !== "all") {
      const currentComponent =
        selectedNode?.component ??
        (selectedEdge ? nodes.get(selectedEdge.from)?.component : undefined);
      if (currentComponent !== next) {
        const preferredName =
          next === "est" ? "BRESCIA" : "MILANO CADORNA";
        const preferred = data.nodes.find(
          (node) => node.name === preferredName,
        );
        if (preferred) setSelection({ type: "node", id: preferred.id });
      }
    }
    setView(
      next === "all"
        ? FULL
        : fit(data.nodes.filter((node) => node.component === next)),
    );
  };
  const focusNode = (node: Node) => {
    const point = positions.get(node.id)!;
    const w = 430;
    const h = w / RATIO;
    setSelection({ type: "node", id: node.id });
    setArea("all");
    setView({
      x: Math.max(0, Math.min(point.x - w / 2, W - w)),
      y: Math.max(0, Math.min(point.y - h / 2, H - h)),
      w,
      h,
    });
    setQuery("");
  };
  const zoomAt = (factor: number, cx?: number, cy?: number) =>
    setView((current) => {
      const centerX = cx ?? current.x + current.w / 2;
      const centerY = cy ?? current.y + current.h / 2;
      const nextW = Math.max(250, Math.min(W, current.w / factor));
      const nextH = nextW / RATIO;
      const rx = (centerX - current.x) / current.w;
      const ry = (centerY - current.y) / current.h;
      return {
        x: Math.max(0, Math.min(centerX - rx * nextW, W - nextW)),
        y: Math.max(0, Math.min(centerY - ry * nextH, H - nextH)),
        w: nextW,
        h: nextH,
      };
    });
  const wheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    zoomAt(
      event.deltaY < 0 ? 1.18 : 0.84,
      view.x + ((event.clientX - rect.left) / rect.width) * view.w,
      view.y + ((event.clientY - rect.top) / rect.height) * view.h,
    );
  };
  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pan.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      view,
    };
  };
  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const start = pan.current;
    if (!start || start.id !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - start.x) / rect.width) * start.view.w;
    const dy = ((event.clientY - start.y) / rect.height) * start.view.h;
    setView({
      ...start.view,
      x: Math.max(0, Math.min(start.view.x - dx, W - start.view.w)),
      y: Math.max(0, Math.min(start.view.y - dy, H - start.view.h)),
    });
  };
  const pointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pan.current?.id === event.pointerId) pan.current = null;
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div>
            <p>FERROVIENORD</p>
            <h1>Mappa interattiva della rete</h1>
          </div>
        </div>
        <div className="stats" aria-label="Sintesi rete">
          <div>
            <strong>{data.meta.displayedLocalities}</strong>
            <span>punti rete</span>
          </div>
          <div>
            <strong>{data.meta.displayedSections}</strong>
            <span>tratte uniche</span>
          </div>
          <div>
            <strong>{data.meta.networkLengthKm.toLocaleString("it-IT")} km</strong>
            <span>sviluppo rete</span>
          </div>
        </div>
        <div className="updated">
          <i />
          Aggiornata al 29 giu 2026
        </div>
      </header>

      <section className="workspace">
        <aside className="filters">
          <div className="panel-title">
            <strong>Esplora la rete</strong>
            <span>Dati verificati</span>
          </div>

          <label className="field-label" htmlFor="search">
            Cerca località o codice
          </label>
          <div className="search">
            <b aria-hidden="true">⌕</b>
            <input
              id="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Es. Saronno, SNO, LO5048"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Cancella">
                ×
              </button>
            )}
          </div>
          {query.trim() && (
            <div className="results">
              {results.length ? (
                results.map((node) => (
                  <button type="button" key={node.id} onClick={() => focusNode(node)}>
                    <i className={node.component} />
                    <span>
                      <strong>{node.name}</strong>
                      <small>{node.sigla ?? "—"} · {node.code ?? `PIC ${node.id}`}</small>
                    </span>
                    <b>↗</b>
                  </button>
                ))
              ) : (
                <p>Nessuna località trovata.</p>
              )}
            </div>
          )}

          <fieldset>
            <legend>Area</legend>
            <div className="segmented">
              {(
                [
                  ["all", "Tutta"],
                  ["ovest", "Ovest"],
                  ["est", "Est"],
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={area === value ? "active" : ""}
                  onClick={() => chooseArea(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Località visualizzate</legend>
            <div className="choices">
              {(
                [
                  ["all", "Rete completa", "134 punti incluse le interconnessioni"],
                  ["passenger", "Servizio viaggiatori", "Località abilitate al servizio"],
                  ["interchange", "Interconnessioni", "Punti di contatto con altra rete"],
                ] as const
              ).map(([value, title, detail]) => (
                <button
                  type="button"
                  key={value}
                  className={mode === value ? "active" : ""}
                  onClick={() => setMode(value)}
                >
                  <i />
                  <span>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Etichette</legend>
            <div className="segmented">
              {(
                [
                  ["major", "Principali"],
                  ["all", "Tutte"],
                  ["none", "Nessuna"],
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={labels === value ? "active" : ""}
                  onClick={() => setLabels(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="legend">
            <h2>Legenda</h2>
            <div>
              <i className="line west" />
              <span>
                <strong>Rete Ovest</strong>
                <small>Milano · Varese · Como · Novara</small>
              </span>
            </div>
            <div>
              <i className="line east" />
              <span>
                <strong>Rete Est</strong>
                <small>Brescia · Iseo · Edolo</small>
              </span>
            </div>
            <div>
              <i className="diamond" />
              <span>
                <strong>Interconnessione</strong>
                <small>Località di altra rete</small>
              </span>
            </div>
          </div>

          <div className="source">
            <span>Fonte</span>
            <strong>Modello Rete — Località e Tratte</strong>
            <small>272 record consolidati in 136 collegamenti bidirezionali.</small>
          </div>
        </aside>

        <div className="map-stage">
          <div className="map-caption">
            <span>Vista geografica</span>
            <strong>
              {area === "all" ? "Intera rete FERROVIENORD" : COMPONENTS[area].detail}
            </strong>
            <b>Zoom {Math.round(zoom * 100)}%</b>
          </div>
          <svg
            className="network-map"
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            role="img"
            aria-label="Mappa interattiva della rete FERROVIENORD"
            onWheel={wheel}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
          >
            <defs>
              <pattern id="grid-minor" width="24" height="24" patternUnits="userSpaceOnUse">
                <path d="M24 0H0V24" fill="none" stroke="#183244" strokeWidth=".55" />
              </pattern>
              <pattern id="grid" width="120" height="120" patternUnits="userSpaceOnUse">
                <rect width="120" height="120" fill="url(#grid-minor)" />
                <path d="M120 0H0V120" fill="none" stroke="#294657" strokeWidth=".9" />
              </pattern>
            </defs>
            <rect width={W} height={H} fill="#071824" />
            <rect width={W} height={H} fill="url(#grid)" />
            <g>
              {visibleEdges.map((edge) => {
                const from = positions.get(edge.from);
                const to = positions.get(edge.to);
                if (!from || !to) return null;
                const component = nodes.get(edge.from)?.component ?? "ovest";
                const selected = selection.type === "edge" && selection.id === edge.id;
                const adjacent =
                  selection.type === "node" &&
                  (edge.from === selection.id || edge.to === selection.id);
                return (
                  <line
                    key={edge.id}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={selected || adjacent ? "#fff" : COMPONENTS[component].color}
                    strokeWidth={(selected ? 7 : adjacent ? 4.7 : 2.25) / zoom}
                    strokeOpacity={mode === "interchange" ? 0.2 : selected ? 1 : adjacent ? 0.94 : 0.72}
                    strokeLinecap="round"
                    className="track"
                    role="button"
                    tabIndex={0}
                    aria-label={`Tratta ${nodes.get(edge.from)?.name} – ${nodes.get(edge.to)?.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelection({ type: "edge", id: edge.id });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ")
                        setSelection({ type: "edge", id: edge.id });
                    }}
                  >
                    <title>
                      {nodes.get(edge.from)?.name} – {nodes.get(edge.to)?.name} · {km(edge.lengthMeters)} km
                    </title>
                  </line>
                );
              })}
            </g>
            <g>
              {visibleNodes.map((node) => {
                const point = positions.get(node.id)!;
                const selected = selection.type === "node" && selection.id === node.id;
                const showLabel =
                  selected ||
                  (labels !== "none" &&
                    (labels === "all" || node.major || (degree.get(node.id) ?? 0) >= 3 || zoom >= 2.4));
                const radius = (selected ? 8 : node.major ? 5.5 : 4.2) / zoom;
                return (
                  <g
                    key={node.id}
                    className="station"
                    role="button"
                    tabIndex={0}
                    aria-label={`Apri ${node.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelection({ type: "node", id: node.id });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ")
                        setSelection({ type: "node", id: node.id });
                    }}
                  >
                    {selected && (
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={14 / zoom}
                        fill="none"
                        stroke="#fff"
                        strokeWidth={2.2 / zoom}
                      />
                    )}
                    {node.border ? (
                      <rect
                        x={point.x - radius}
                        y={point.y - radius}
                        width={radius * 2}
                        height={radius * 2}
                        rx={1 / zoom}
                        transform={`rotate(45 ${point.x} ${point.y})`}
                        fill="#ffbf47"
                        stroke="#071824"
                        strokeWidth={1.7 / zoom}
                      />
                    ) : (
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={radius}
                        fill={selected ? "#fff" : COMPONENTS[node.component].color}
                        stroke="#071824"
                        strokeWidth={1.7 / zoom}
                      />
                    )}
                    {showLabel && (
                      <text
                        x={point.x + 9 / zoom}
                        y={point.y - 8 / zoom}
                        fontSize={(selected ? 12.5 : 10.5) / zoom}
                        fontWeight={selected || node.major ? 700 : 560}
                        fill={selected ? "#fff" : "#dceaf2"}
                        stroke="#071824"
                        strokeWidth={3.4 / zoom}
                        paintOrder="stroke"
                      >
                        {node.name}
                      </text>
                    )}
                    <title>{node.name} · {node.sigla ?? "sigla non indicata"}</title>
                  </g>
                );
              })}
            </g>
          </svg>

          <div className="map-controls">
            <button type="button" onClick={() => zoomAt(1.25)} aria-label="Aumenta zoom">+</button>
            <button type="button" onClick={() => zoomAt(0.8)} aria-label="Riduci zoom">−</button>
            <button
              type="button"
              onClick={() => setView(area === "all" ? FULL : fit(areaNodes))}
              aria-label="Adatta mappa"
            >
              ⛶
            </button>
          </div>
          <div className="north" aria-hidden="true"><span>N</span><i /></div>
          <div className="map-help">
            <span>Trascina per muovere</span><i />
            <span>Scorri per zoomare</span><i />
            <span>Seleziona un punto o una tratta</span>
          </div>
        </div>

        <aside className="details" aria-live="polite">
          {selectedNode && (
            <>
              <div className="detail-hero">
                <div>
                  <span className={`badge ${selectedNode.component}`}>
                    {COMPONENTS[selectedNode.component].label}
                  </span>
                  {selectedNode.border && <span className="badge boundary">Interconnessione</span>}
                </div>
                <h2>{selectedNode.name}</h2>
                <p>{selectedNode.sigla ?? "Sigla n.d."}<i />{selectedNode.code ?? `PIC ${selectedNode.id}`}</p>
              </div>
              <div className="detail-grid">
                <div><span>Codice PIC</span><strong>{selectedNode.id}</strong></div>
                <div><span>Quota</span><strong>{selectedNode.altitude === null ? "—" : `${selectedNode.altitude.toLocaleString("it-IT")} m`}</strong></div>
                <div><span>Viaggiatori</span><strong>{selectedNode.passenger ? "Abilitata" : "No"}</strong></div>
                <div><span>Traffico</span><strong>{selectedNode.traffic}</strong></div>
              </div>
              <section className="detail-section">
                <div className="section-heading"><h3>Collegamenti diretti</h3><span>{connections.length}</span></div>
                <div className="connections">
                  {connections.length ? connections.map(({ edge, node, count, min, max }) => (
                    <button type="button" key={node.id} onClick={() => focusNode(node)}>
                      <i className={node.component} />
                      <span>
                        <strong>{node.name}</strong>
                        <small>
                          {count > 1
                            ? `${count} tratte · ${km(min)}–${km(max)} km`
                            : `${km(edge.lengthMeters)} km · ${
                                edge.massCategory
                                  ? `massa ${edge.massCategory}`
                                  : "massa n.d."
                              }`}
                        </small>
                      </span>
                      <b>›</b>
                    </button>
                  )) : <p>Nessun collegamento presente nei record tratta.</p>}
                </div>
              </section>
              <section className="detail-section technical">
                <h3>Dati tecnici</h3>
                <dl>
                  <div><dt>Codice MIR</dt><dd>{selectedNode.mirCode ?? "—"}</dd></div>
                  <div><dt>Tipo località</dt><dd>Codice {selectedNode.typeCode}</dd></div>
                  <div><dt>Rete proprietaria</dt><dd>Codice {selectedNode.owner}</dd></div>
                  <div><dt>Validità da</dt><dd>{date(selectedNode.activeFrom)}</dd></div>
                </dl>
              </section>
            </>
          )}
          {selectedEdge && (
            <>
              <div className="detail-hero">
                <div><span className={`badge ${nodes.get(selectedEdge.from)?.component ?? "ovest"}`}>Tratta selezionata</span></div>
                <h2 className="route">
                  {nodes.get(selectedEdge.from)?.name}<b>→</b>{nodes.get(selectedEdge.to)?.name}
                </h2>
                <p>PIC {selectedEdge.id}{selectedEdge.routeCode && <><i />{selectedEdge.routeCode}</>}</p>
              </div>
              <div className="length"><span>Lunghezza</span><strong>{km(selectedEdge.lengthMeters)} km</strong></div>
              <section className="detail-section technical">
                <h3>Caratteristiche</h3>
                <dl>
                  <div><dt>Traffico</dt><dd>{selectedEdge.traffic}</dd></div>
                  <div><dt>Trazione</dt><dd>{selectedEdge.tractionCode === 4 ? "Elettrica" : `Codice ${selectedEdge.tractionCode}`}</dd></div>
                  <div><dt>Blocco</dt><dd>Codice {selectedEdge.blockCode}</dd></div>
                  <div><dt>Controllo</dt><dd>{selectedEdge.controlCode === null ? "Non indicato" : `Sistema ${selectedEdge.controlCode}`}</dd></div>
                  <div><dt>Massa assiale</dt><dd>{selectedEdge.massCategory ?? "Non indicata"}</dd></div>
                  <div><dt>Validità da</dt><dd>{date(selectedEdge.activeFrom)}</dd></div>
                </dl>
              </section>
              <div className="route-actions">
                <button type="button" onClick={() => setSelection({ type: "node", id: selectedEdge.from })}>Apri origine</button>
                <button type="button" onClick={() => setSelection({ type: "node", id: selectedEdge.to })}>Apri destinazione</button>
              </div>
            </>
          )}
        </aside>
      </section>
    </main>
  );
}

export default function Home() {
  const ready = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );

  if (!ready) {
    return (
      <main className="boot-screen">
        <Logo />
        <div>
          <p>FERROVIENORD</p>
          <span>Preparazione della mappa di rete…</span>
        </div>
      </main>
    );
  }

  return <NetworkApp />;
}

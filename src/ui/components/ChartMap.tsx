import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { boatStyle, type LatLon, type LogEntry } from '../../domain';

export interface MapRoute {
  id: string;
  points: readonly LatLon[];
}

/** Routen und Einträge eines Boots: Farbe + Symbolform nach `colorIndex`, optional Bootsname an der Route. */
export interface MapLayer {
  id: string;
  colorIndex: number;
  /** Bootsname am letzten Punkt (nur wenn gesetzt). */
  label?: string;
  routes: readonly MapRoute[];
  entries: readonly LogEntry[];
}

export interface ChartMapProps {
  layers: readonly MapLayer[];
  onOpenEntry?: (entryId: string) => void;
  /** Ändert sich der Schlüssel, wird die Karte neu auf die Daten eingepasst. */
  fitKey: string;
  label: string;
  compact?: boolean;
  /** Letzte bekannte Position, falls keine Daten vorhanden sind. */
  fallback?: LatLon;
}

const KIEL_BAY: LatLon = { lat: 54.45, lon: 10.25 };
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>-Mitwirkende';
const FILLED_TYPES = new Set<LogEntry['type']>(['harbour', 'anchorage', 'mooring']);
const GRID_STEPS_MIN = [1, 5, 10, 30, 60, 120, 300, 600];

interface Colors {
  boats: string[];
  grid: string;
  surface: string;
  ink: string;
}

const BOAT_FALLBACK = ['#0a66a8', '#c4560a', '#23823f', '#7a3fb0'];

function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  return {
    boats: BOAT_FALLBACK.map((f, i) => get(`--b${i + 1}`, f)),
    grid: get('--grid', '#a8739f'), surface: get('--surface', '#ffffff'), ink: get('--ink', '#0d2848'),
  };
}

/** SVG-Symbol eines Eintrags: Form je Boot (Kreis, Quadrat, Dreieck, Raute), gefüllt bei Hafen/Anker/Boje. */
export function markerSvg(style: number, color: string, fill: string, size = 20): string {
  const c = size / 2;
  const r = size / 2 - 3;
  const attrs = `fill="${fill}" stroke="${color}" stroke-width="3"`;
  let shape: string;
  if (style === 2) shape = `<rect x="${c - r}" y="${c - r}" width="${2 * r}" height="${2 * r}" rx="1" ${attrs}/>`;
  else if (style === 3) shape = `<path d="M${c} ${c - r * 1.15}L${c + r * 1.15} ${c + r * 0.85}L${c - r * 1.15} ${c + r * 0.85}Z" stroke-linejoin="round" ${attrs}/>`;
  else if (style === 4) shape = `<path d="M${c} ${c - r * 1.25}L${c + r * 1.25} ${c}L${c} ${c + r * 1.25}L${c - r * 1.25} ${c}Z" stroke-linejoin="round" ${attrs}/>`;
  else shape = `<circle cx="${c}" cy="${c}" r="${r}" ${attrs}/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${shape}</svg>`;
}

/** Zählt Theme-Wechsel (data-theme oder Systemeinstellung), damit Farben neu gelesen werden. */
function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = (): void => setVersion((v) => v + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;
    mq?.addEventListener('change', bump);
    return () => {
      observer.disconnect();
      mq?.removeEventListener('change', bump);
    };
  }, []);
  return version;
}

/** Gradnetz: 5′ ab Zoom 10, sonst 10′; wird bei vielen Linien automatisch gröber. */
export function gridStepMin(zoom: number, latSpanDeg: number, lonSpanDeg: number): number {
  const base = zoom >= 10 ? 5 : 10;
  const candidates = GRID_STEPS_MIN.filter((s) => s >= base);
  return (
    candidates.find((s) => (latSpanDeg * 60) / s + (lonSpanDeg * 60) / s <= 30) ??
    candidates[candidates.length - 1] ??
    600
  );
}

function drawGrid(map: L.Map, layer: L.LayerGroup, color: string): void {
  layer.clearLayers();
  const size = map.getSize();
  if (size.x === 0 || size.y === 0) return;
  const b = map.getBounds();
  const step = gridStepMin(map.getZoom(), b.getNorth() - b.getSouth(), b.getEast() - b.getWest()) / 60;
  const style: L.PolylineOptions = { color, weight: 1, opacity: 0.75, interactive: false };
  const south = Math.max(b.getSouth(), -85);
  const north = Math.min(b.getNorth(), 85);
  for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
    L.polyline(
      [
        [lat, b.getWest()],
        [lat, b.getEast()],
      ],
      style,
    ).addTo(layer);
  }
  for (let lon = Math.ceil(b.getWest() / step) * step; lon <= b.getEast(); lon += step) {
    L.polyline(
      [
        [south, lon],
        [north, lon],
      ],
      style,
    ).addTo(layer);
  }
}

interface MapState {
  map: L.Map;
  grid: L.LayerGroup;
  data: L.LayerGroup;
  refit: () => void;
}

/** Leaflet-Seekarte (OSM-Kacheln auf Wasserfarbe + Gradnetz, damit sie auch ohne Kacheln lesbar bleibt). */
export function ChartMap({ layers, onOpenEntry, fitKey, label, compact = false, fallback }: ChartMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<MapState | null>(null);
  const openRef = useRef(onOpenEntry);
  const fitState = useRef({ key: '', sized: false });
  const latest = useRef({ layers, fallback, fitKey });
  const theme = useThemeVersion();

  useEffect(() => {
    openRef.current = onOpenEntry;
    latest.current = { layers, fallback, fitKey };
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const map = L.map(el, {
      attributionControl: true,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      dragging: !(compact && L.Browser.mobile),
      maxZoom: 18,
    });
    map.attributionControl.setPrefix(false);
    map.setView([KIEL_BAY.lat, KIEL_BAY.lon], 9);
    L.tileLayer(TILE_URL, { maxZoom: 18, attribution: ATTRIBUTION }).addTo(map);
    const grid = L.layerGroup().addTo(map);
    const data = L.layerGroup().addTo(map);

    const refit = (): void => {
      const { layers: ls, fallback: fb } = latest.current;
      const pts: L.LatLngTuple[] = [];
      for (const f of ls) {
        for (const r of f.routes) for (const p of r.points) pts.push([p.lat, p.lon]);
        for (const e of f.entries) if (e.position) pts.push([e.position.lat, e.position.lon]);
      }
      if (pts.length === 0) {
        const c = fb ?? KIEL_BAY;
        map.setView([c.lat, c.lon], fb ? 11 : 9, { animate: false });
      } else if (pts.length === 1 || L.latLngBounds(pts).getNorthEast().equals(L.latLngBounds(pts).getSouthWest())) {
        map.setView(pts[0] as L.LatLngTuple, 13, { animate: false });
      } else {
        // Platz für Bootsnamen am Routenende und die Zoom-Knöpfe
        map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [56, 44], paddingBottomRight: [40, 28], maxZoom: 15, animate: false });
      }
    };

    const redrawGrid = (): void => drawGrid(map, grid, readColors().grid);
    map.on('moveend', redrawGrid);
    state.current = { map, grid, data, refit };

    const ro =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            map.invalidateSize();
            if (!fitState.current.sized) {
              fitState.current.sized = true;
              refit();
            }
            redrawGrid();
          })
        : undefined;
    ro?.observe(el);

    return () => {
      ro?.disconnect();
      map.off('moveend', redrawGrid);
      map.remove();
      state.current = null;
      fitState.current = { key: '', sized: false };
    };
  }, [compact]);

  // Daten + Farben zeichnen (Farben bei jedem Theme-Wechsel neu aus den CSS-Variablen).
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const colors = readColors();
    s.data.clearLayers();
    let count = 0;
    for (const f of layers) {
      const style = boatStyle(f);
      const color = colors.boats[style - 1] ?? colors.ink;
      let anchor: L.LatLngTuple | undefined;
      for (const r of f.routes) {
        if (r.points.length < 2) continue;
        const line = r.points.map((p): L.LatLngTuple => [p.lat, p.lon]);
        L.polyline(line, { color, weight: 3.5, opacity: 0.9, lineJoin: 'round' }).addTo(s.data);
        anchor = line[line.length - 1];
        count++;
      }
      for (const e of f.entries) {
        if (!e.position) continue;
        anchor ??= [e.position.lat, e.position.lon];
        const fill = FILLED_TYPES.has(e.type) ? color : colors.surface;
        L.marker([e.position.lat, e.position.lon], {
          icon: L.divIcon({ className: 'boat-mk', html: markerSvg(style, color, fill), iconSize: [20, 20], iconAnchor: [10, 10] }),
          keyboard: false,
          title: f.label ?? '',
        })
          .on('click', () => openRef.current?.(e.id))
          .addTo(s.data);
        count++;
      }
      if (anchor && f.label) {
        L.circleMarker(anchor, { radius: 1, opacity: 0, fillOpacity: 0, interactive: false })
          .bindTooltip(f.label, { permanent: true, direction: 'top', className: `boat-label b${style}` })
          .addTo(s.data);
      }
    }
    drawGrid(s.map, s.grid, colors.grid);
    const key = `${fitKey}|${count === 0 ? 'empty' : 'data'}`;
    if (fitState.current.key !== key) {
      fitState.current.key = key;
      s.refit();
    }
  }, [layers, fitKey, theme]);

  return (
    <div className="mapframe">
      <div
        ref={host}
        className={compact ? 'chartmap compact' : 'chartmap'}
        role="group"
        aria-label={label}
        data-testid="chart-map"
      />
    </div>
  );
}

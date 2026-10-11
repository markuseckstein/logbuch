import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type { LatLon, LogEntry } from '../../domain';

export interface MapRoute {
  id: string;
  points: readonly LatLon[];
}

export interface ChartMapProps {
  routes: readonly MapRoute[];
  entries: readonly LogEntry[];
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
  magenta: string;
  grid: string;
  surface: string;
}

function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  return { magenta: get('--magenta', '#b0106a'), grid: get('--grid', '#a8739f'), surface: get('--surface', '#ffffff') };
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
export function ChartMap({ routes, entries, onOpenEntry, fitKey, label, compact = false, fallback }: ChartMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<MapState | null>(null);
  const openRef = useRef(onOpenEntry);
  const fitState = useRef({ key: '', sized: false });
  const latest = useRef({ routes, entries, fallback, fitKey });
  const theme = useThemeVersion();

  useEffect(() => {
    openRef.current = onOpenEntry;
    latest.current = { routes, entries, fallback, fitKey };
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
      const { routes: rs, entries: es, fallback: fb } = latest.current;
      const pts: L.LatLngTuple[] = [];
      for (const r of rs) for (const p of r.points) pts.push([p.lat, p.lon]);
      for (const e of es) if (e.position) pts.push([e.position.lat, e.position.lon]);
      if (pts.length === 0) {
        const c = fb ?? KIEL_BAY;
        map.setView([c.lat, c.lon], fb ? 11 : 9, { animate: false });
      } else if (pts.length === 1 || L.latLngBounds(pts).getNorthEast().equals(L.latLngBounds(pts).getSouthWest())) {
        map.setView(pts[0] as L.LatLngTuple, 13, { animate: false });
      } else {
        map.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 15, animate: false });
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
    for (const r of routes) {
      if (r.points.length < 2) continue;
      L.polyline(
        r.points.map((p): L.LatLngTuple => [p.lat, p.lon]),
        { color: colors.magenta, weight: 3.5, opacity: 0.9, lineJoin: 'round' },
      ).addTo(s.data);
    }
    for (const e of entries) {
      if (!e.position) continue;
      const filled = FILLED_TYPES.has(e.type);
      L.circleMarker([e.position.lat, e.position.lon], {
        radius: 8,
        color: colors.magenta,
        weight: 3,
        fillColor: filled ? colors.magenta : colors.surface,
        fillOpacity: 1,
      })
        .on('click', () => openRef.current?.(e.id))
        .addTo(s.data);
    }
    drawGrid(s.map, s.grid, colors.grid);
    const key = `${fitKey}|${routes.length + entries.length === 0 ? 'empty' : 'data'}`;
    if (fitState.current.key !== key) {
      fitState.current.key = key;
      s.refit();
    }
  }, [routes, entries, fitKey, theme]);

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

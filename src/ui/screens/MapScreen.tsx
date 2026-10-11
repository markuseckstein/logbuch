import { useMemo, useState } from 'react';
import { pickFile } from '../../device';
import { db } from '../../db/db';
import { addTrack, deleteTrack } from '../../db/repo';
import { GpxParseError, parseGpx } from '../../io';
import { formatTime, localDate, type Track, type Trip } from '../../domain';
import { useApp } from '../AppContext';
import { useTripDays } from '../hooks';
import { Icon } from '../icons';
import { currentTzOffsetMin, num1 } from '../lib';
import { useLiveRoute } from '../live';
import { useToast } from '../toast';
import { ChartMap, type MapRoute } from '../components/ChartMap';

/** „10.08. 09:12 – 14:40“ bzw. „ohne Zeit“. */
export function trackPeriod(points: Track['points'], tzOffsetMin: number): string {
  const times = points.flatMap((p) => (p.time === undefined ? [] : [p.time]));
  if (times.length === 0) return 'ohne Zeit';
  const first = Math.min(...times);
  const last = Math.max(...times);
  const fmt = (t: number): string => {
    const [, m = '', d = ''] = localDate(t, tzOffsetMin).split('-');
    return `${d}.${m}. ${formatTime(t, tzOffsetMin)}`;
  };
  return first === last ? fmt(first) : `${fmt(first)} – ${fmt(last)}`;
}

function TrackList({ tracks }: { tracks: readonly Track[] }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState<string>();
  const tz = currentTzOffsetMin();
  if (tracks.length === 0) return <p className="muted">Noch keine importierten oder aufgezeichneten Tracks.</p>;
  return (
    <ul className="list-plain" aria-label="Tracks">
      {tracks.map((t) =>
        confirming === t.id ? (
          <li key={t.id}>
            <div className="confirm" role="alertdialog" aria-label="Löschen bestätigen">
              <p>Track „{t.name}“ wirklich löschen?</p>
              <button className="btn" type="button" autoFocus onClick={() => setConfirming(undefined)}>
                Abbrechen
              </button>
              <button
                className="btn danger"
                type="button"
                onClick={() => {
                  setConfirming(undefined);
                  void deleteTrack(db, t.id).then(() => toast(`Track „${t.name}“ gelöscht`));
                }}
              >
                Endgültig löschen
              </button>
            </div>
          </li>
        ) : (
          <li key={t.id}>
            <span className="grow">
              <b>{t.name}</b>
              <span className="dmeta">
                {t.source === 'gpx' ? 'GPX' : 'Live'} · {t.points.length} Punkte · {trackPeriod(t.points, tz)}
              </span>
            </span>
            <button
              className="icon-btn"
              type="button"
              aria-label={`Track „${t.name}“ löschen`}
              onClick={() => setConfirming(t.id)}
            >
              <Icon name="trash" size={20} />
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

function GpxCard({ trip, tracks }: { trip: Trip; tracks: readonly Track[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const importGpx = async (): Promise<void> => {
    setError(undefined);
    const file = await pickFile('.gpx,application/gpx+xml');
    if (!file) return;
    setBusy(true);
    try {
      const parsed = parseGpx(await file.text());
      const usable = parsed.tracks.filter((t) => t.points.length > 0);
      if (usable.length === 0) {
        setError('Die Datei enthält keine Tracks mit Punkten (nur Wegpunkte oder Routen werden nicht importiert).');
        return;
      }
      const fallbackName = file.name.replace(/\.gpx$/i, '');
      for (const t of usable) {
        await addTrack(db, trip.id, { name: t.name || fallbackName, source: 'gpx', points: t.points });
      }
      const n = usable.reduce((a, t) => a + t.points.length, 0);
      toast(`GPX „${file.name}“ importiert · ${usable.length} Track${usable.length === 1 ? '' : 's'}, ${n} Punkte`);
    } catch (e) {
      setError(e instanceof GpxParseError ? e.message : 'Die GPX-Datei konnte nicht gelesen werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-label="GPX">
      <button className="btn block" type="button" disabled={busy} onClick={() => void importGpx()}>
        <Icon name="up" size={20} />
        GPX importieren
      </button>
      {error ? (
        <div className="err" role="alert">
          {error}
        </div>
      ) : null}
      <TrackList tracks={tracks} />
    </section>
  );
}

function LiveCard() {
  const live = useLiveRoute();
  return (
    <section className="card" aria-label="Live-Route">
      <button className="toggle" type="button" role="switch" aria-checked={live.active} onClick={live.toggle}>
        <span className="track" />
        <span>
          <b>Live-Route aufzeichnen</b>
          <br />
          <span className="muted">Bildschirm bleibt an</span>
        </span>
      </button>
      <p className="muted">
        Standardmäßig aus. Die Aufzeichnung läuft nur im Vordergrund und hält den Bildschirm wach – das kostet spürbar
        Akku. Die Route ergibt sich auch aus deinen Einträgen.
      </p>
    </section>
  );
}

export function MapScreen({ trip }: { trip: Trip }) {
  const data = useTripDays(trip);
  const { openEntry } = useApp();
  const [chosen, setFilter] = useState<string>('all');
  const filter = data?.days.some((d) => d.date === chosen) ? chosen : 'all';

  const view = useMemo(() => {
    if (!data) return undefined;
    const days = filter === 'all' ? data.days : data.days.filter((d) => d.date === filter);
    const routes: MapRoute[] = days.map((d) => ({ id: d.date, points: d.route }));
    if (filter === 'all') data.untimed.forEach((points, i) => routes.push({ id: `untimed-${i}`, points }));
    const entries = days.flatMap((d) => d.entries);
    const sm = days.reduce((a, d) => a + d.stats.distanceNm, 0);
    return { days, routes, entries, sm };
  }, [data, filter]);

  if (!data || !view) return null;

  return (
    <main className="screen" aria-labelledby="screen-title">
      <h2 id="screen-title">Törnkarte</h2>
      <div className="chips chips-row" role="group" aria-label="Tage anzeigen">
        <button className="chip" type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          Alle
        </button>
        {data.days.map((d) => (
          <button
            key={d.date}
            className="chip"
            type="button"
            aria-pressed={filter === d.date}
            onClick={() => setFilter(d.date)}
          >
            Tag {d.no}
          </button>
        ))}
      </div>
      <ChartMap
        label="Törnkarte"
        routes={view.routes}
        entries={view.entries}
        onOpenEntry={(id) => openEntry(id)}
        fitKey={`${filter}:${view.entries.length}:${data.tracks.length}`}
      />
      <div className="muted num">
        {num1(view.sm)} sm · {view.entries.length} Einträge
      </div>
      <GpxCard trip={trip} tracks={data.tracks} />
      <LiveCard />
    </main>
  );
}

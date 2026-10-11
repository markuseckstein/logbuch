import { useMemo, useState } from 'react';
import { pickFile } from '../../device';
import { db } from '../../db/db';
import { useAllBoats } from '../../db/hooks';
import { addTrack, deleteTrack } from '../../db/repo';
import { GpxParseError, parseGpx } from '../../io';
import { canEditRecord, formatTime, localDate, type ID, type Track, type Trip } from '../../domain';
import { useApp } from '../AppContext';
import { BoatChooser, BoatShape, boatColor, useBoatSelection } from '../boats';
import { useTripAccess } from '../cloudHooks';
import { useReadOnly, useTripDays } from '../hooks';
import { Icon } from '../icons';
import { boatLayers, currentTzOffsetMin, num1, writeErrorMessage } from '../lib';
import { useLiveRoute } from '../live';
import { useToast } from '../toast';
import { ChartMap } from '../components/ChartMap';

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

function TrackList({ tripId, tracks }: { tripId: ID; tracks: readonly Track[] }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState<string>();
  const access = useTripAccess(tripId);
  const boats = useAllBoats(tripId);
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
                  void deleteTrack(db, t.id).then(
                    () => toast(`Track „${t.name}“ gelöscht`),
                    (e: unknown) => toast(writeErrorMessage(e, 'Track konnte nicht gelöscht werden')),
                  );
                }}
              >
                Endgültig löschen
              </button>
            </div>
          </li>
        ) : (
          <li key={t.id}>
            {(() => {
              const b = boats.find((x) => x.id === t.boatId);
              return b ? <BoatShape boat={b} /> : null;
            })()}
            <span className="grow">
              <b>{t.name}</b>
              <span className="dmeta">
                {boats.find((x) => x.id === t.boatId)?.name ?? ''} · {t.source === 'gpx' ? 'GPX' : 'Live'} · {t.points.length}{' '}
                Punkte · {trackPeriod(t.points, tz)}
              </span>
            </span>
            {canEditRecord(t, access) ? (
              <button
                className="icon-btn"
                type="button"
                aria-label={`Track „${t.name}“ löschen`}
                onClick={() => setConfirming(t.id)}
              >
                <Icon name="trash" size={20} />
              </button>
            ) : null}
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
  const [choosing, setChoosing] = useState(false);
  const { selected, boats } = useBoatSelection();

  const importGpx = async (boatId: ID): Promise<void> => {
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
        await addTrack(db, trip.id, { boatId, name: t.name || fallbackName, source: 'gpx', points: t.points });
      }
      const n = usable.reduce((a, t) => a + t.points.length, 0);
      const boat = boats.length > 1 ? ` · ${boats.find((b) => b.id === boatId)?.name ?? ''}` : '';
      toast(`GPX „${file.name}“ importiert · ${usable.length} Track${usable.length === 1 ? '' : 's'}, ${n} Punkte${boat}`);
    } catch (e) {
      setError(e instanceof GpxParseError ? e.message : writeErrorMessage(e, 'Die GPX-Datei konnte nicht gelesen werden.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-label="GPX">
      <button
        className="btn block"
        type="button"
        disabled={busy}
        onClick={() => (selected ? void importGpx(selected.id) : setChoosing(true))}
      >
        <Icon name="up" size={20} />
        GPX importieren{selected && boats.length > 1 ? ` · ${selected.name}` : ''}
      </button>
      {choosing ? (
        <BoatChooser
          title="GPX importieren"
          confirmLabel="Datei wählen"
          onCancel={() => setChoosing(false)}
          onConfirm={(id) => {
            setChoosing(false);
            void importGpx(id);
          }}
        />
      ) : null}
      {error ? (
        <div className="err" role="alert">
          {error}
        </div>
      ) : null}
      <TrackList tripId={trip.id} tracks={tracks} />
    </section>
  );
}

function LiveCard() {
  const live = useLiveRoute();
  const { selected, boats } = useBoatSelection();
  const [choosing, setChoosing] = useState(false);
  const recording = boats.find((b) => b.id === live.boatId);
  const toggle = (): void => {
    if (live.active) live.stop();
    else if (selected) live.start(selected.id);
    else setChoosing(true);
  };
  return (
    <section className="card" aria-label="Live-Route">
      <button className="toggle" type="button" role="switch" aria-checked={live.active} onClick={toggle}>
        <span className="track" />
        <span>
          <b>Live-Route aufzeichnen</b>
          <br />
          <span className="muted">
            Bildschirm bleibt an
            {boats.length > 1 && (recording ?? selected) ? ` · ${(recording ?? selected)!.name}` : ''}
          </span>
        </span>
      </button>
      {choosing ? (
        <BoatChooser
          title="Live-Route"
          confirmLabel="Aufzeichnung starten"
          onCancel={() => setChoosing(false)}
          onConfirm={(id) => {
            setChoosing(false);
            live.start(id);
          }}
        />
      ) : null}
      <p className="muted">
        Standardmäßig aus. Die Aufzeichnung läuft nur im Vordergrund und hält den Bildschirm wach – das kostet spürbar
        Akku. Die Route ergibt sich auch aus deinen Einträgen.
      </p>
    </section>
  );
}

export function MapScreen({ trip }: { trip: Trip }) {
  const data = useTripDays(trip);
  const readOnly = useReadOnly(trip.id);
  const { openEntry } = useApp();
  const { boats } = useBoatSelection();
  const [hidden, setHidden] = useState<ReadonlySet<ID>>(new Set());
  const [chosen, setFilter] = useState<string>('all');
  const filter = data?.days.some((d) => d.date === chosen) ? chosen : 'all';

  const view = useMemo(() => {
    if (!data) return undefined;
    const dates = filter === 'all' ? undefined : [filter];
    const all = boatLayers(trip, boats, data.entries, data.tracks, { dates, labels: boats.length > 1 });
    const layers = all.filter((l) => !hidden.has(l.id));
    const sm = layers.reduce((a, l) => a + l.distanceNm, 0);
    const count = layers.reduce((a, l) => a + l.entries.length, 0);
    const totals = boatLayers(trip, boats, data.entries, data.tracks);
    return { layers, sm, count, totals };
  }, [data, filter, trip, boats, hidden]);

  if (!data || !view) return null;
  const toggleBoat = (id: ID): void => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
  };

  return (
    <main className="screen" aria-labelledby="screen-title">
      <h2 id="screen-title">Törnkarte</h2>
      <div className="chips chips-row" role="group" aria-label="Tage anzeigen">
        <button className="chip" type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          Alle Tage
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
        label="Törnkarte aller Boote"
        layers={view.layers}
        onOpenEntry={(id) => openEntry(id)}
        fitKey={`${filter}:${view.count}:${data.tracks.length}:${[...hidden].join(',')}`}
      />
      <div className="muted num">
        {num1(view.sm)} sm · {view.count} Einträge
        {boats.length > 1 ? ` · ${boats.length - hidden.size} von ${boats.length} Booten sichtbar` : ''}
      </div>
      {boats.length > 1 ? (
        <section className="card" aria-label="Legende">
          <div className="legend">Legende</div>
          <ul className="mleg">
            {boats.map((b) => {
              const on = !hidden.has(b.id);
              const total = view.totals.find((l) => l.id === b.id);
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    style={boatColor(b)}
                    aria-label={`${b.name} ${on ? 'ausblenden' : 'einblenden'}`}
                    onClick={() => toggleBoat(b.id)}
                  >
                    <BoatShape boat={b} size={16} />
                    <span className="ml-t">
                      <b>{b.name}</b>
                      <span>
                        {b.model ? `${b.model} · ` : ''}
                        {num1(total?.distanceNm ?? 0)} sm · {total?.entries.length ?? 0} Einträge
                      </span>
                    </span>
                    <span className="sw">{on ? 'sichtbar' : 'aus'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="muted">Jedes Boot hat Farbe und Symbolform. Tippe auf einen Eintrag in der Karte, um ihn zu öffnen.</p>
        </section>
      ) : null}
      {readOnly ? null : (
        <>
          <GpxCard trip={trip} tracks={data.tracks} />
          <LiveCard />
        </>
      )}
    </main>
  );
}

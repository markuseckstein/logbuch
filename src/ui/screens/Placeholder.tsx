interface PlaceholderProps {
  title: string;
  hint: string;
}

/** Platzhalter für Screens, die in Teil 2 umgesetzt werden. */
export function PlaceholderScreen({ title, hint }: PlaceholderProps) {
  return (
    <main className="screen" aria-labelledby="screen-title">
      <h2 id="screen-title">{title}</h2>
      <div className="card">
        <p className="muted">{hint}</p>
        <p className="muted">Dieser Bereich kommt in Teil 2.</p>
      </div>
    </main>
  );
}

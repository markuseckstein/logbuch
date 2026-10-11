import { useState } from 'react';
import { ROLE_LABELS, type CrewDraft } from '../../domain';
import { Icon } from '../icons';

type Role = NonNullable<CrewDraft['role']>;
const ROLES = Object.keys(ROLE_LABELS) as Role[];

interface CrewEditorProps {
  crew: readonly CrewDraft[];
  onChange: (crew: CrewDraft[]) => void;
  defaultRole?: Role;
  emptyText?: string;
}

/** Crew-Liste mit Rolle ändern/entfernen und Formular zum Hinzufügen (kontrolliert). */
export function CrewEditor({ crew, onChange, defaultRole = 'crew', emptyText = 'Noch keine Crew.' }: CrewEditorProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>(defaultRole);
  const [error, setError] = useState(false);

  const add = (): void => {
    const n = name.trim();
    if (!n) {
      setError(true);
      return;
    }
    setError(false);
    onChange([...crew, { id: crypto.randomUUID(), name: n, role }]);
    setName('');
  };

  return (
    <>
      <ul className="crew">
        {crew.length === 0 ? (
          <li className="muted" style={{ border: 0 }}>
            {emptyText}
          </li>
        ) : null}
        {crew.map((c) => (
          <li key={c.id}>
            <b>{c.name}</b>
            <select
              className="role-select"
              aria-label={`Rolle von ${c.name}`}
              value={c.role ?? 'crew'}
              onChange={(e) => onChange(crew.map((m) => (m.id === c.id ? { ...m, role: e.target.value as Role } : m)))}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button
              className="icon-btn"
              type="button"
              aria-label={`${c.name} entfernen`}
              onClick={() => onChange(crew.filter((m) => m.id !== c.id))}
            >
              <Icon name="x" size={18} />
            </button>
          </li>
        ))}
      </ul>
      <div className="row2">
        <label className="f">
          <span>Name</span>
          <input
            type="text"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        </label>
        <label className="f">
          <span>Rolle</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <div className="err">Bitte einen Namen eingeben.</div> : null}
      <button className="btn block" type="button" onClick={add}>
        Crew hinzufügen
      </button>
    </>
  );
}

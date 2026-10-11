interface ImportMetaEnv {
  /** Dexie-Cloud-Datenbank-URL (öffentlich). Fehlt sie, läuft die App rein lokal. */
  readonly VITE_DEXIE_CLOUD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

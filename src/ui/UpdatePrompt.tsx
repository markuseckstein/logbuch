import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;
  return (
    <div className="update-toast" role="status">
      <span>Neue Version verfügbar</span>
      <button type="button" onClick={() => void updateServiceWorker(true)}>
        Neu laden
      </button>
    </div>
  );
}

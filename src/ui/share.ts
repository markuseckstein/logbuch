/** Link teilen (Web Share), sonst in die Zwischenablage; `notify` meldet das Ergebnis (Toast). */
export async function shareLink(data: { title: string; text: string; url: string }, notify: (msg: string) => void): Promise<void> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  await copyText(data.url, notify, 'Link in die Zwischenablage kopiert', 'Link konnte nicht kopiert werden – bitte markieren und kopieren');
}

export async function copyText(text: string, notify: (msg: string) => void, ok: string, fail: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify(ok);
  } catch {
    notify(fail);
  }
}

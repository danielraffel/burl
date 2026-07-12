import { ipcRenderer } from 'electron';

export function NeutralControl() {
  document.addEventListener('selectionchange', () => {});
  ipcRenderer.invoke('neutral:read');
  return <button role="switch" aria-checked="false" onClick={() => {}}>Neutral</button>;
}

export const css = `.neutral:hover { color: red; mystery-prop: 1; }`;

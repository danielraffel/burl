// Tiny dependency-inversion seam between bridge event dispatch and the React
// reconciler instance. React 19 no longer flushes LegacyRoot event updates
// before a native callback returns, but Burl's established bridge contract is
// synchronous. index.ts installs reconciler.flushSync here without introducing
// a prop-applier -> index.ts import cycle.

type EventFlusher = <T>(callback: () => T) => T;

let flushEvent: EventFlusher = (callback) => callback();

export function installHostEventFlusher(flusher: EventFlusher): void {
    flushEvent = flusher;
}

export function runHostEvent<T>(callback: () => T): T {
    return flushEvent(callback);
}

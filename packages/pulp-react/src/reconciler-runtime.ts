// Tiny dependency-inversion seam between bridge event dispatch and the React
// reconciler instance. React 19 no longer flushes LegacyRoot event updates
// before a native callback returns, but Burl's established bridge contract is
// synchronous. index.ts installs reconciler.flushSync here without introducing
// a prop-applier -> index.ts import cycle.

type EventFlusher = <T>(callback: () => T) => T;

type HostEventGlobal = typeof globalThis & {
    __pulpRunHostEvent__?: EventFlusher;
};

let flushEvent: EventFlusher = (callback) => callback();
let hostEventDepth = 0;

export function installHostEventFlusher(flusher: EventFlusher): void {
    flushEvent = flusher;
    // WidgetBridge owns the backend-neutral event fan-out for native widget,
    // window, and document listeners. Publish the reconciler boundary there
    // as an optional capability so global keyboard and outside-click handlers
    // commit with the same synchronous semantics as intrinsic prop handlers.
    // Non-React consumers simply run through WidgetBridge's direct fallback.
    (globalThis as HostEventGlobal).__pulpRunHostEvent__ = (callback) =>
        runHostEvent(callback);
}

export function runHostEvent<T>(callback: () => T): T {
    // WidgetBridge wraps the whole native dispatch, while intrinsic handlers
    // also call this function directly. Avoid nesting discreteUpdates and
    // flushSyncWork when an intrinsic callback is reached through the bridge.
    if (hostEventDepth > 0) return callback();
    ++hostEventDepth;
    try {
        return flushEvent(callback);
    } finally {
        --hostEventDepth;
    }
}

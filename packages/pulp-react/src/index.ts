// @pulp/react — react-reconciler host for pulp::view::WidgetBridge.
//
// Public API:
//   import { render, unmount, View, Row, Spectrum, Button, ... } from '@pulp/react';
//
//   render(<MyApp />, rootContainer)  // or just render(<MyApp />) for the default root
//   unmount(rootContainer)
//
// Plus all the intrinsics from intrinsics.ts.

import createReactReconciler from 'react-reconciler';
import { LegacyRoot } from 'react-reconciler/constants.js';
import type { ReactElement, ReactNode, ReactPortal } from 'react';
import type { OpaqueRoot } from 'react-reconciler';

import { PulpHostConfig } from './host-config.js';
import type { PulpContainer } from './types.js';
import { installHostEventFlusher } from './reconciler-runtime.js';

// ── Reconciler ─────────────────────────────────────────────────────
// react-reconciler returns a factory; we keep a single shared instance
// so DevTools registration only happens once per JS engine load.
const reconciler = createReactReconciler(PulpHostConfig as unknown as Parameters<typeof createReactReconciler>[0]);

// React 19's reconciler keeps the legacy-root tag but schedules ordinary
// updateContainer calls. Burl's public render() contract predates that change:
// bridge mutations are observable before render() returns. Prefer the React 19
// sync entry points and retain the flushSync fallback for older reconciler
// builds used by source checkouts during migration.
type SyncReconciler = typeof reconciler & {
    updateContainerSync?: (
        element: ReactNode,
        container: OpaqueRoot,
        parentComponent: null,
        callback: null,
    ) => unknown;
    flushSyncWork?: () => unknown;
    discreteUpdates?: <T>(callback: () => T) => T;
};

const syncReconciler = reconciler as SyncReconciler;
installHostEventFlusher((callback) => {
    const result = typeof syncReconciler.discreteUpdates === 'function'
        ? syncReconciler.discreteUpdates(callback)
        : callback();
    syncReconciler.flushSyncWork?.();
    return result;
});

function updateContainerSynchronously(element: ReactNode, root: OpaqueRoot): void {
    if (typeof syncReconciler.updateContainerSync === 'function') {
        syncReconciler.updateContainerSync(element, root, null, null);
        syncReconciler.flushSyncWork?.();
        return;
    }
    reconciler.flushSync(() => {
        reconciler.updateContainer(element, root, null, null);
    });
}

// Optional DevTools hookup (no-op if devtools not present).
try {
    reconciler.injectIntoDevTools({
        bundleType: 0,             // 0 = production, 1 = development
        version: '0.0.1',
        rendererPackageName: '@pulp/react',
    });
} catch { /* no devtools — ignore */ }

// ── Container management ───────────────────────────────────────────
interface RootRecord {
    container: PulpContainer;
    fiberRoot: OpaqueRoot;
}

const rootsByContainer = new WeakMap<PulpContainer, RootRecord>();

/// Create a new container rooted at the given bridge widget id.
/// Plugin authors call this once at startup with the id of the
/// outermost widget Pulp gives them ('' is the convention for the
/// implicit root — see widget_bridge.cpp's root_ handling).
export function createRoot(rootId: string = '', idPrefix?: string): PulpContainer {
    return { rootId, idPrefix, nextId: 0 };
}

/// Render a React element into the given container.
/// If no container is passed, creates one rooted at '' (the bridge's
/// implicit root) on first call and reuses it thereafter.
let defaultContainer: PulpContainer | null = null;

export function render(element: ReactElement, container?: PulpContainer): PulpContainer {
    const c = container ?? (defaultContainer ??= createRoot(''));
    let rec = rootsByContainer.get(c);
    if (!rec) {
        // react-reconciler 0.31 / React 19 added uncaught + caught handlers
        // before the recoverable handler. Keep all three explicit so argument
        // shifting cannot silently leave onRecoverableError undefined.
        const fiberRoot = (reconciler.createContainer as unknown as (...args: unknown[]) => OpaqueRoot)(
            c,
            // LegacyRoot = synchronous mode. Matches the v0 architecture
            // doc ("Concurrent mode: deferred for v0") and means each
            // render() returns after the bridge calls have all been
            // emitted — no microtask gap, which is what tests and
            // AOT-bundled plugin code both expect.
            LegacyRoot,
            null,
            false,
            null,
            '@pulp/react',
            (err: Error) => { console.error('[@pulp/react] uncaught error:', err); },
            (err: Error) => { console.error('[@pulp/react] caught error:', err); },
            (err: Error) => { console.error('[@pulp/react] recoverable error:', err); },
            null,
        );
        rec = { container: c, fiberRoot };
        rootsByContainer.set(c, rec);
    }
    updateContainerSynchronously(element, rec.fiberRoot);
    return c;
}

export function createPortal(children: ReactNode, container: PulpContainer, key?: string | null): ReactPortal {
    return reconciler.createPortal(children, container, null, key) as unknown as ReactPortal;
}

/// Unmount and clear the container.
export function unmount(container: PulpContainer): void {
    const rec = rootsByContainer.get(container);
    if (!rec) return;
    updateContainerSynchronously(null, rec.fiberRoot);
    rootsByContainer.delete(container);
    if (defaultContainer === container) defaultContainer = null;
}

// ── Re-export intrinsics + types ───────────────────────────────────
export * from './intrinsics.js';
export type {
    ViewProps, RowProps, ColProps, PanelProps, ScrollViewProps, ModalProps,
    LabelProps, ButtonProps, TextEditorProps,
    KnobProps, FaderProps, SpectrumProps, WaveformProps, MeterProps,
    ProgressProps, XYPadProps, CheckboxProps, ToggleProps, ComboProps,
    ListBoxProps, VirtualListProps, CanvasProps, ImageProps, IconProps, SvgPathProps,
    SvgRectProps, SvgLineProps, BadgeProps, StepperProps, PanProps,
    FlexDirection, FlexAlign, FlexAlignSelf, FlexJustify,
    FlexProps, StyleProps, BaseProps,
    IntrinsicElementMap, IntrinsicElementName,
    PulpContainer,
} from './types.js';

// ── Ink & Signal design-system catalog ─────────────────────────────
export {
    inkSignalCatalog, findComponent, componentsByCategory, FIGMA_FILE_KEY,
} from './design-system.js';
export type { DesignComponent, DesignCategory } from './design-system.js';

export type {
    PulpBridgeCapability,
    PulpBridgeGlobals,
    PulpBridgeAlwaysGlobals,
    PulpBridgeExecGlobals,
    PulpBridgeClipboardGlobals,
    PulpBridgeFilesystemGlobals,
    PulpBridgeStorageGlobals,
    PulpBridgeAiGlobals,
    PulpBridgeRuntimeImportGlobals,
} from './bridge-globals.generated.js';

// ── Re-export the mock bridge for downstream tests ─────────────────
export { createMockBridge } from './bridge.js';
export type { MockBridge, MockBridgeCall } from './bridge.js';

// ── Keyboard shortcuts ─────────────────────────────────────────────
export {
    useShortcut,
    registerShortcut,
    parseShortcut,
    MOD_SHIFT, MOD_CTRL, MOD_ALT, MOD_META, MOD_CMD,
} from './shortcuts.js';
export type { ParsedShortcut } from './shortcuts.js';

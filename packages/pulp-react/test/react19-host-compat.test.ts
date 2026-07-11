import { readFileSync } from 'node:fs';
import { createElement, useState, version as reactVersion } from 'react';
import { describe, expect, it } from 'vitest';

import { createMockBridge } from '../src/bridge.js';
import { PulpHostConfig } from '../src/host-config.js';
import { Label, View } from '../src/intrinsics.js';
import { createRoot, render, unmount } from '../src/index.js';

describe('React 19 reconciler host compatibility', () => {
    it('locks the supported React 19 and reconciler 0.31 family', () => {
        const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        expect(reactVersion).toMatch(/^19\./);
        expect(pkg.peerDependencies.react).toBe('^19.0.0');
        expect(pkg.dependencies['react-reconciler']).toBe('^0.31.0');
        expect(pkg.dependencies.scheduler).toBe('^0.25.0');
    });

    it('provides React 19 commit-suspension and transition hooks', () => {
        expect(PulpHostConfig.maySuspendCommit?.('View' as never, {} as never)).toBe(false);
        expect(PulpHostConfig.preloadInstance?.('View' as never, {} as never)).toBe(true);
        expect(PulpHostConfig.waitForCommitToBeReady?.()).toBeNull();
        expect(PulpHostConfig.HostTransitionContext).toBeDefined();
        expect(PulpHostConfig.NotPendingTransition).toBeNull();
    });

    it('retains synchronous bridge mutations for render and native events', () => {
        function Counter() {
            const [count, setCount] = useState(0);
            return createElement(View, { id: 'counter', onClick: () => setCount((n) => n + 1) },
                createElement(Label, { id: 'count' }, String(count)));
        }

        const bridge = createMockBridge();
        bridge.install();
        const root = createRoot('root');
        try {
            render(createElement(Counter), root);
            const click = bridge.calls.find(
                (call) => call.fn === 'on' && call.args[0] === 'counter' && call.args[1] === 'click',
            )?.args[2] as (() => void) | undefined;
            expect(typeof click).toBe('function');

            bridge.reset();
            click?.();
            expect(bridge.calls).toContainEqual({ fn: 'setText', args: ['count', '1'] });
        } finally {
            unmount(root);
            bridge.uninstall();
        }
    });
});

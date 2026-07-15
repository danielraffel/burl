import { afterEach, describe, expect, it } from 'vitest';

import {
    installHostEventFlusher,
    runHostEvent,
} from '../src/reconciler-runtime.js';

type HostEventGlobal = typeof globalThis & {
    __pulpRunHostEvent__?: <T>(callback: () => T) => T;
};

const hostGlobal = globalThis as HostEventGlobal;

afterEach(() => {
    delete hostGlobal.__pulpRunHostEvent__;
    installHostEventFlusher((callback) => callback());
    delete hostGlobal.__pulpRunHostEvent__;
});

describe('reconciler host-event boundary', () => {
    it('publishes the same flusher for intrinsic and WidgetBridge dispatch', () => {
        const order: string[] = [];
        installHostEventFlusher((callback) => {
            order.push('enter');
            const result = callback();
            order.push('flush');
            return result;
        });

        expect(runHostEvent(() => {
            order.push('intrinsic');
            return 17;
        })).toBe(17);
        expect(hostGlobal.__pulpRunHostEvent__?.(() => {
            order.push('global');
            return 23;
        })).toBe(23);
        expect(order).toEqual([
            'enter', 'intrinsic', 'flush',
            'enter', 'global', 'flush',
        ]);
    });

    it('does not nest reconciler flushes when bridge dispatch reaches an intrinsic', () => {
        const order: string[] = [];
        installHostEventFlusher((callback) => {
            order.push('enter');
            const result = callback();
            order.push('flush');
            return result;
        });

        hostGlobal.__pulpRunHostEvent__?.(() => {
            order.push('bridge');
            runHostEvent(() => order.push('intrinsic'));
        });

        expect(order).toEqual(['enter', 'bridge', 'intrinsic', 'flush']);
    });
});

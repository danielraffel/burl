import { describe, expect, it } from 'vitest';
import { lowerObservedDom, toNativeDesignIrV1, type ObservedDomNode } from '../src/index.js';

describe('observed cursor route', () => {
    const lower = (cursor: string) => lowerObservedDom({ sourceId: cursor, tagName: 'div',
        computedStyle: { display: 'block', cursor }, rect: { x: 0, y: 0, width: 40, height: 20 }, children: [] }, 'now');

    it('preserves each supported portable cursor intent', () => {
        for (const cursor of ['auto', 'default', 'pointer', 'text'] as const) {
            const typed = lower(cursor);
            expect(typed.paint?.cursor).toBe(cursor);
            expect(toNativeDesignIrV1(typed, { sourceFile: '/cursor', importedAt: 'now' }).root.style?.cursor).toBe(cursor);
        }
    });

    it('fails closed for URL and fallback lists', () => {
        for (const cursor of ['url(cursor.png), pointer', 'url(cursor.svg) 4 4, auto']) {
            const typed = lower(cursor);
            expect(typed.paint?.cursor).toBeUndefined();
            expect(typed.meta?.observed_style_diagnostics).toContainEqual(expect.objectContaining({
                property: 'cursor', code: 'css-cursor-unsupported', value: cursor,
            }));
        }
    });
});

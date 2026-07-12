import { describe, expect, it } from 'vitest';
import { classifyObservedDomLayout, loweredLayoutFor } from '../src/adapters/observed-dom/layout-capability.js';
import { lowerObservedDomWithLayoutReport, type ObservedDomNode } from '../src/adapters/observed-dom/lower.js';

function node(overrides: Partial<ObservedDomNode> = {}): ObservedDomNode {
    return {
        sourceId: 'root',
        tagName: 'div',
        computedStyle: { display: 'block' },
        rect: { x: 0, y: 0, width: 200, height: 100 },
        children: [],
        ...overrides,
    };
}

describe('observed DOM display capability', () => {
    it('lowers geometry-proven simple block flow to column flex', () => {
        const source = node({
            computedStyle: { display: 'block', paddingTop: '4px' },
            children: [
                node({ sourceId: 'a', rect: { x: 0, y: 10, width: 200, height: 20 }, computedStyle: { display: 'block', marginTop: '6px', marginBottom: '8px' } }),
                node({ sourceId: 'b', rect: { x: 0, y: 42, width: 200, height: 20 }, computedStyle: { display: 'block', marginTop: '12px' } }),
            ],
        });
        const { root, layoutReport } = lowerObservedDomWithLayoutReport(source, '2026-07-11T00:00:00Z');
        expect(layoutReport.entries[0]).toMatchObject({ capability: 'block-simple', lowering: 'column-flex' });
        expect(layoutReport.entries[0].geometryOracle).toEqual({ tolerance: 0.5, maxDelta: 0, matches: true });
        expect(root.layout).toMatchObject({ display: 'flex', flexDirection: 'column' });
        expect(root.children[0].layout).toMatchObject({ marginTop: 6, marginBottom: 0 });
        expect(root.children[1].layout).toMatchObject({ marginTop: 12, marginBottom: 0 });
        expect(root.children[0].layout.width).toBeUndefined();
        expect(root.children[0].layout.alignSelf).toBe('stretch');
    });

    it('uses observed geometry as a fail-closed oracle', () => {
        const source = node({ children: [node({ sourceId: 'child', rect: { x: 0, y: 9, width: 200, height: 20 }, computedStyle: { display: 'block' } })] });
        const report = classifyObservedDomLayout(source);
        expect(report.entries[0].capability).toBe('unsupported');
        expect(report.diagnostics[0]).toMatchObject({ code: 'layout-geometry-diverged', sourceId: 'root' });
        expect(report.entries[0].lowering).toBe('observed-geometry-projection');
    });

    it('ignores zero-area live regions when proving block flow', () => {
        const source = node({ children: [
            node({ sourceId: 'app', rect: { x: 0, y: 0, width: 200, height: 100 }, computedStyle: { display: 'flex', position: 'relative' } }),
            node({ sourceId: 'live', tagName: 'section', rect: { x: 0, y: 0, width: 200, height: 0 }, computedStyle: { display: 'flex' } }),
        ] });
        const { root, layoutReport } = lowerObservedDomWithLayoutReport(source, 'now');
        expect(layoutReport.entries[0]).toMatchObject({ capability: 'block-simple', lowering: 'column-flex' });
        expect(root.layout).toMatchObject({ display: 'flex', flexDirection: 'column' });
        expect(root.children[1].layout).toMatchObject({ marginTop: 0, marginBottom: 0 });
    });

    it('classifies pure inline text as attributed text', () => {
        const source = node({ children: [
            node({ sourceId: 'plain', tagName: 'span', text: 'Hello ', computedStyle: { display: 'inline' } }),
            node({ sourceId: 'em', tagName: 'em', text: 'world', computedStyle: { display: 'inline' } }),
        ] });
        const report = classifyObservedDomLayout(source);
        expect(report.entries[0]).toMatchObject({
            capability: 'inline-text', lowering: 'attributed-text', diagnostics: [],
        });
        expect(report.entries.map((entry) => entry.capability)).toEqual([
            'inline-text', 'inline-text', 'inline-text',
        ]);
        expect(report.diagnostics).toEqual([]);
    });

    it.each([
        ['float', node({ computedStyle: { display: 'block', cssFloat: 'left' } }), /float:left/],
        ['table', node({ computedStyle: { display: 'table' } }), /table layout/],
        ['columns', node({ computedStyle: { display: 'block', columnCount: '2' } }), /multi-column/],
        ['mixed flow', node({ children: [
            node({ sourceId: 'text', tagName: 'span', computedStyle: { display: 'inline' } }),
            node({ sourceId: 'box', tagName: 'button', computedStyle: { display: 'inline-block' } }),
        ] }), /mixed inline flow/],
        ['positioned child', node({ children: [
            node({ sourceId: 'positioned', computedStyle: { display: 'block', position: 'absolute' } }),
        ] }), /safe native lowering/],
    ])('diagnoses unsupported %s without partial lowering', (_name, source, message) => {
        const entry = classifyObservedDomLayout(source).entries[0];
        expect(entry.capability).toBe('unsupported');
        expect(entry.lowering).toBe('observed-geometry-projection');
        expect(entry.diagnostics.map((diagnostic) => diagnostic.reason).join('\n')).toMatch(message);
    });

    it('requires observed children to fill the available inline size', () => {
        const source = node({ computedStyle: { display: 'block', paddingLeft: '10px', paddingRight: '20px' },
            children: [node({ sourceId: 'child', rect: { x: 10, y: 0, width: 170, height: 20 },
                computedStyle: { display: 'block' } })] });
        expect(classifyObservedDomLayout(source).entries[0].capability).toBe('block-simple');
        source.children[0].rect.width = 160;
        expect(classifyObservedDomLayout(source).entries[0]).toMatchObject({
            capability: 'unsupported', lowering: 'observed-geometry-projection',
        });
    });

    it('keeps direct flex and grid layouts unchanged', () => {
        for (const display of ['flex', 'inline-flex', 'grid']) {
            const source = node({ computedStyle: { display } });
            const entry = classifyObservedDomLayout(source).entries[0];
            const base = { display, width: 200, height: 100 };
            expect(entry.capability).toBe('direct');
            expect(loweredLayoutFor(source, entry, base)).toBe(base);
        }
    });
});

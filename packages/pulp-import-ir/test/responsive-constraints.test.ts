import { describe, expect, test } from 'vitest';
import { alignStableObservedDomIdentities, alignStableObservedDomIdentitiesWithReport, applyResponsiveConstraints, reconcileResponsiveConstraints, unionResponsiveTrees } from '../src/responsive-constraints.js';
import { lowerObservedDom } from '../src/adapters/observed-dom/lower.js';
import type { ObservedDomNode } from '../src/adapters/observed-dom/lower.js';

const node = (sourceId: string, width: number, height: number, children: ObservedDomNode[] = [], style: Record<string, string> = {}): ObservedDomNode => ({
    sourceId, tagName: 'div', attributes: {}, computedStyle: { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', ...style },
    rect: { x: 0, y: 0, width, height }, children,
});

describe('multi-viewport constraint reconciliation', () => {
    test('keeps source-proven fitting labels intrinsic without widening real ellipsis boxes', () => {
        const capture = (width: number) => {
            const fitting = node('fitting-label', 62, 22, [], {
                display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                width: '62px', lineHeight: '22px', flexGrow: '0',
            });
            fitting.tagName = 'span';
            fitting.content = [{ kind: 'text', text: 'This Mac', rect: {
                x: 40, y: 2, width: 62, height: 18,
            } }];
            const truncated = node('truncated-title', 188.5, 22, [], {
                display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                width: '188.5px', lineHeight: '22px', flexGrow: '0',
            });
            truncated.tagName = 'span';
            truncated.content = [{ kind: 'text', text: 'Build hero section with animated gradient', rect: {
                x: 40, y: 2, width: 251.25, height: 18,
            } }];
            const authored = node('authored-width-label', 62, 22, [], {
                display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                width: '62px', lineHeight: '22px', flexGrow: '0',
            });
            authored.tagName = 'span';
            authored.content = [{ kind: 'text', text: 'This Mac', rect: {
                x: 40, y: 2, width: 62, height: 18,
            } }];
            authored.styleProvenance = { width: [{ value: '62px', origin: 'authored' }] };
            authored.styleProvenanceWinners = { width: '62px' };
            return { viewport: { width, height: 800 }, root: node('root', width, 800,
                [fitting, truncated, authored]) };
        };
        const captures = [capture(768), capture(1200), capture(1440)];
        const reconciliation = reconcileResponsiveConstraints(captures);
        expect(reconciliation.intrinsicWidthIds.has('fitting-label')).toBe(true);
        expect(reconciliation.constraints.get('fitting-label')?.horizontal).toBeUndefined();
        expect(reconciliation.intrinsicWidthIds.has('truncated-title')).toBe(false);
        expect(reconciliation.intrinsicWidthIds.has('authored-width-label')).toBe(false);
        expect(reconciliation.constraints.get('truncated-title')?.horizontal).toMatchObject({
            kind: 'fixed', value: 188.5,
        });
        const lowered = applyResponsiveConstraints(
            lowerObservedDom(captures.at(-1)!.root, 'now'), reconciliation);
        expect(lowered.children[0].layout?.width).toBe('auto');
        expect(lowered.children[0].layout?.minWidth).toBe('auto');
        expect(lowered.children[1].layout?.width).toBe(188.5);
        expect(lowered.children[2].layout?.width).toBe(62);
    });

    test('does not freeze source auto width into a redundant responsive equation', () => {
        const capture = (width: number) => {
            const child = node('intrinsic-child', width - 18, 13);
            child.styleProvenance = {};
            child.styleProvenanceComplete = true;
            return { viewport: { width, height: 600 }, root: node('root', width, 600, [child]) };
        };
        const result = reconcileResponsiveConstraints([capture(600), capture(900), capture(1200)]);
        const child = result.constraints.get('intrinsic-child');
        expect(child?.horizontal).toBeUndefined();
        expect(child?.horizontalVariants).toBeUndefined();
        expect(child?.vertical).toMatchObject({ kind: 'fixed', value: 13 });
    });

    test('does not freeze changing intrinsic auto heights into width variants', () => {
        const capture = (width: number, viewportHeight: number, textHeight: number) => {
            const text = node('wrapped-text', width - 32, textHeight, [], {
                display: 'block', flexGrow: '0', height: `${textHeight}px`, lineHeight: '22px',
            });
            text.styleProvenance = {};
            text.styleProvenanceComplete = false;
            text.content = [{ kind: 'text', text: 'A wrapped intrinsic text sample', rect: {
                x: 0, y: 2, width: width - 48, height: textHeight - 4,
            } }];
            return {
                viewport: { width, height: viewportHeight },
                root: node('root', width, viewportHeight, [text]),
            };
        };
        const result = reconcileResponsiveConstraints([
            capture(280, 420, 154), capture(280, 800, 154),
            capture(599, 420, 66), capture(599, 800, 66),
            capture(768, 420, 44), capture(768, 800, 44),
        ]);
        const text = result.constraints.get('wrapped-text');
        expect(text?.vertical).toBeUndefined();
        expect(text?.verticalVariants).toBeUndefined();
        expect(result.intrinsicHeightIds.has('wrapped-text')).toBe(true);
        const lowered = lowerObservedDom(capture(768, 800, 44).root, 'now');
        expect(applyResponsiveConstraints(lowered, result).children[0].layout?.height).toBe('auto');
    });

    test('recovers content-hug height from repeated observed child geometry without authored provenance', () => {
        const capture = (width: number, viewportHeight: number, lines: number) => {
            const textHeight = lines * 22;
            const text = node('message-text', width - 64, textHeight);
            text.tagName = 'p';
            text.rect.y = 12;
            text.content = [{ kind: 'text', text: 'A source-captured wrapping message', rect: {
                x: 0, y: 12, width: width - 64, height: textHeight,
            } }];
            const message = node('message', width - 32, textHeight + 24, [text], {
                display: 'flex', flexDirection: 'column', flexGrow: '0',
                paddingTop: '12px', paddingBottom: '12px',
            });
            return { viewport: { width, height: viewportHeight }, root: node('root', width, viewportHeight, [message]) };
        };
        const captures = [
            capture(280, 420, 6), capture(280, 800, 6),
            capture(599, 420, 3), capture(599, 800, 3),
            capture(1200, 420, 2), capture(1200, 800, 2),
        ];
        const reconciliation = reconcileResponsiveConstraints(captures);
        expect(reconciliation.intrinsicHeightIds.has('message')).toBe(true);
        expect(reconciliation.constraints.get('message')?.vertical).toBeUndefined();
        const lowered = lowerObservedDom(captures.at(-1)!.root, 'now');
        expect(applyResponsiveConstraints(lowered, reconciliation).children[0].layout?.height).toBe('auto');
        expect(applyResponsiveConstraints(lowered, reconciliation).children[0].layout?.minHeight).toBe('auto');
    });

    test('keeps responsive auto-height form groups intrinsic instead of inventing a width breakpoint', () => {
        const capture = (width: number, viewportHeight: number, controlsHeight: number) => {
            const textarea = node('composer-textarea', width - 26, 64, [], {
                display: 'flex', flexGrow: '1', position: 'static', marginBottom: '0px',
            });
            textarea.rect = { x: 13, y: 1, width: width - 26, height: 64 };
            const action = node('composer-action', width - 26, controlsHeight, [], {
                display: 'flex', flexGrow: '0', position: 'static', marginBottom: '0px',
            });
            action.rect = { x: 13, y: 65, width: width - 26, height: controlsHeight };
            const sentinel = node('composer-focus-sentinel', 1, 1, [], {
                display: 'block', position: 'fixed', flexGrow: '0',
            });
            sentinel.rect = { x: -1, y: -1, width: 1, height: 1 };
            const controls = node('composer-controls', width - 26, controlsHeight,
                [action, sentinel], {
                    display: 'flex', flexWrap: 'wrap', flexGrow: '0', position: 'static',
                });
            controls.styleProvenance = {};
            controls.rect = { x: 13, y: 65, width: width - 26, height: controlsHeight };
            const groupHeight = 64 + controlsHeight + 2;
            const group = node('composer-group', width - 24, groupHeight, [textarea, controls], {
                display: 'flex', flexDirection: 'column', flexGrow: '0',
                borderTopWidth: '1px', borderBottomWidth: '1px',
            });
            group.styleProvenance = {};
            const form = node('composer-form', width - 24, groupHeight, [group], {
                display: 'block', flexGrow: '0',
            });
            form.styleProvenance = {};
            return { viewport: { width, height: viewportHeight }, root: node('root', width, viewportHeight, [form]) };
        };
        const captures = [
            capture(280, 420, 120), capture(280, 800, 120),
            capture(599, 420, 46), capture(599, 800, 46),
            capture(1200, 420, 46), capture(1200, 800, 46),
        ];
        const reconciliation = reconcileResponsiveConstraints(captures);
        expect(reconciliation.intrinsicHeightIds.has('composer-group')).toBe(true);
        expect(reconciliation.intrinsicHeightIds.has('composer-form')).toBe(true);
        expect(reconciliation.intrinsicHeightIds.has('composer-controls')).toBe(true);
        expect(reconciliation.constraints.get('composer-group')?.verticalVariants).toBeUndefined();
        expect(reconciliation.constraints.get('composer-form')?.verticalVariants).toBeUndefined();
        const form = applyResponsiveConstraints(lowerObservedDom(captures.at(-1)!.root, 'now'), reconciliation)
            .children[0];
        expect(form.layout?.height).toBe('auto');
        expect(form.children[0].layout?.height).toBe('auto');
    });

    test('does not classify authored fixed-height containers as intrinsic', () => {
        const capture = (width: number, fixedHeight: number) => {
            const child = node('fixed-child', width - 24, fixedHeight);
            child.rect = { x: 0, y: 0, width: width - 24, height: fixedHeight };
            const fixed = node('authored-fixed', width - 24, fixedHeight, [child]);
            fixed.styleProvenance = { height: [{ value: `${fixedHeight}px`, origin: 'authored' }] };
            return { viewport: { width, height: 800 }, root: node('root', width, 800, [fixed]) };
        };
        const reconciliation = reconcileResponsiveConstraints([
            capture(280, 186), capture(599, 112), capture(1200, 112),
        ]);
        expect(reconciliation.intrinsicHeightIds.has('authored-fixed')).toBe(false);
        const fixed = applyResponsiveConstraints(
            lowerObservedDom(capture(1200, 112).root, 'now'), reconciliation).children[0];
        expect(fixed.layout?.height).not.toBe('auto');
    });

    test('propagates proven intrinsic height through single-child alignment wrappers', () => {
        const capture = (width: number, viewportHeight: number, lines: number) => {
            const textHeight = lines * 22;
            const text = node('message-text', width - 64, textHeight);
            text.tagName = 'p';
            text.rect.y = 12;
            text.content = [{ kind: 'text', text: 'A source-captured wrapping message', rect: {
                x: 0, y: 12, width: width - 64, height: textHeight,
            } }];
            const bubble = node('message-bubble', width - 32, textHeight + 24, [text], {
                flexDirection: 'column', paddingTop: '12px', paddingBottom: '12px',
            });
            const shell = node('message-shell', width - 32, textHeight + 24, [bubble], {
                flexDirection: 'column', justifyContent: 'flex-end',
            });
            return { viewport: { width, height: viewportHeight }, root: node('root', width, viewportHeight, [shell]) };
        };
        const captures = [
            capture(280, 420, 6), capture(280, 800, 6),
            capture(599, 420, 3), capture(599, 800, 3),
            capture(1200, 420, 2), capture(1200, 800, 2),
        ];
        const reconciliation = reconcileResponsiveConstraints(captures);
        expect(reconciliation.intrinsicHeightIds.has('message-text')).toBe(true);
        expect(reconciliation.intrinsicHeightIds.has('message-bubble')).toBe(true);
        expect(reconciliation.intrinsicHeightIds.has('message-shell')).toBe(true);
        expect(reconciliation.constraints.get('message-shell')?.vertical).toBeUndefined();
        const lowered = lowerObservedDom(captures.at(-1)!.root, 'now');
        const shell = applyResponsiveConstraints(lowered, reconciliation).children[0];
        expect(shell.layout?.minHeight).toBe('auto');
        expect(shell.children[0].layout?.minHeight).toBe('auto');
        expect(shell.children[0].children[0].layout?.minHeight).toBe('auto');
    });

    test('retains implicit stretch evidence for auto-width descendants in column containment', () => {
        const capture = (width: number) => {
            const composer = node('composer', width - 25, 40);
            const main = node('main', width - 24, 100, [composer], {
                flexDirection: 'column', alignItems: 'stretch', minWidth: '0px',
            });
            main.styleProvenance = { 'margin-left': [{ value: '12px', origin: 'authored' }] };
            main.styleProvenanceComplete = true;
            return {
                viewport: { width, height: 600 },
                root: node('root', width, 600, [main], {
                    flexDirection: 'column', alignItems: 'stretch',
                }),
            };
        };
        const result = reconcileResponsiveConstraints([capture(280), capture(600), capture(1200)]);
        expect(result.constraints.get('main')?.horizontal).toMatchObject({
            kind: 'fill', offset: -24, residual: 0,
        });
        expect(result.constraints.get('composer')?.horizontal).toMatchObject({
            kind: 'fill', offset: -1, residual: 0,
        });
    });

    test('retains structural visibility when source-owned axes need no equation', () => {
        const auto = (width: number, height: number) => {
            const child = node('conditional-auto', width - 18, height);
            child.styleProvenance = {};
            child.styleProvenanceComplete = true;
            return child;
        };
        const result = reconcileResponsiveConstraints([
            { viewport: { width: 600, height: 600 }, root: node('root', 600, 600) },
            { viewport: { width: 900, height: 600 }, root: node('root', 900, 600, [auto(900, 10)]) },
            { viewport: { width: 1200, height: 600 }, root: node('root', 1200, 600, [auto(1200, 30)]) },
        ]);
        expect(result.constraints.get('conditional-auto')?.horizontal).toBeUndefined();
        expect(result.constraints.get('conditional-auto')?.visibility).toEqual([
            { visible: false, structural: true, transitionToNext: {
                lowerBound: 600, upperBound: 900, confidence: 'bounded',
            } },
            { visible: true, structural: false },
        ]);
    });

    test('keeps zero-size layout participants visible when CSS does not hide them', () => {
        const capture = (width: number) => {
            const separator = node('separator', 1, width < 600 ? 0 : 12, [], {
                display: 'block', visibility: 'visible', height: width < 600 ? '0px' : '12px',
                marginTop: '8px', marginBottom: '8px',
            });
            separator.styleProvenanceWinners = { height: 'auto' };
            return { viewport: { width, height: 420 }, root: node('root', width, 420, [separator]) };
        };
        const result = reconcileResponsiveConstraints([
            capture(280), capture(599), capture(600), capture(1200),
        ]);
        expect(result.constraints.get('separator')?.visibility).toEqual([
            { visible: true, structural: false },
        ]);
        expect(result.constraints.get('separator')?.verticalVariants).toEqual([
            { constraint: { kind: 'fixed', value: 0, residual: 0 }, transitionToNext: {
                lowerBound: 599, upperBound: 600, confidence: 'measured', axis: 'width',
            } },
            { constraint: { kind: 'fixed', value: 12, residual: 0 } },
        ]);
    });

    test('uses same-width height samples to derive independent vertical constraints', () => {
        const capture = (width: number, height: number) => ({
            viewport: { width, height },
            root: node('root', width, height, [node('panel', width - 24, height - 12)]),
        });
        const result = reconcileResponsiveConstraints([
            capture(280, 248), capture(280, 420), capture(600, 420), capture(1200, 420),
        ]);
        expect(result.constraints.get('root')?.vertical).toMatchObject({ kind: 'fill', offset: 0, residual: 0 });
        expect(result.constraints.get('panel')?.horizontal).toMatchObject({ kind: 'fill', offset: -24, residual: 0 });
        expect(result.constraints.get('panel')?.vertical).toMatchObject({ kind: 'fill', offset: -12, residual: 0 });
        expect(result.constraints.get('panel')?.verticalVariants).toBeUndefined();
        expect(result.constraints.get('panel')?.sampledViewports).toEqual([280, 600, 1200]);
    });

    test('leaves remaining-height ownership with positive flex children on a column axis', () => {
        const capture = (width: number, viewportHeight: number, footerHeight: number) => {
            const transcript = node('transcript', width, viewportHeight - footerHeight, [], {
                flexGrow: '1', flexShrink: '1', flexBasis: '0%',
            });
            const footer = node('footer', width, footerHeight);
            const root = node('root', width, viewportHeight, [transcript, footer], {
                display: 'flex', flexDirection: 'column',
            });
            return { viewport: { width, height: viewportHeight }, root };
        };
        const reconciliation = reconcileResponsiveConstraints([
            capture(280, 420, 260.5), capture(599, 420, 186.5),
            capture(1200, 420, 206.5), capture(1200, 800, 206.5),
        ]);
        expect(reconciliation.constraints.get('transcript')?.vertical).toBeUndefined();
        expect(reconciliation.constraints.get('transcript')?.verticalVariants).toBeUndefined();
        expect(reconciliation.constraints.get('footer')?.vertical).toMatchObject({
            kind: 'fixed', value: 206.5,
        });
    });

    test('keeps a wide 1440x900 viewport fluid when sparse width samples were captured at 800px', () => {
        const capture = (width: number, height: number) => ({
            viewport: { width, height },
            root: node('root', width, height, [node('panel', width - 24, height - 12)]),
        });
        const result = reconcileResponsiveConstraints([
            capture(280, 248), capture(280, 420), capture(599, 800),
            capture(600, 800), capture(1024, 800), capture(1200, 800), capture(1400, 800),
        ]);
        const panel = result.constraints.get('panel');
        expect(panel?.vertical).toMatchObject({ kind: 'fill', offset: -12, residual: 0 });
        expect(panel?.verticalVariants).toBeUndefined();
        // The runtime result at 1440x900 is therefore 888px, not the 788px
        // used value observed in the terminal 1400x800 source capture.
        expect(900 + (panel?.vertical?.kind === 'fill' ? panel.vertical.offset : 0)).toBe(888);
    });

    test('rejects a terminal fixed-height segment for an authored auto-height flex item', () => {
        const capture = (width: number, height: number, panelHeight: number) => {
            const panel = node('panel', width - 24, panelHeight, [], { flexGrow: '1', height: `${panelHeight}px` });
            panel.styleProvenance = {};
            panel.styleProvenanceComplete = true;
            panel.styleProvenanceWinners = { height: 'auto' };
            return { viewport: { width, height }, root: node('root', width, height, [panel]) };
        };
        const result = reconcileResponsiveConstraints([
            capture(280, 248, 236), capture(280, 420, 408),
            capture(1200, 800, 788), capture(1200, 900, 788),
        ]);
        expect(result.diagnostics).toContainEqual({
            sourceId: 'panel',
            code: 'terminal-fixed-fluid-height',
            severity: 'error',
            message: expect.stringContaining('auto-height flex item'),
        });
    });

    test('qualifies same-width visibility and layout changes by viewport height', () => {
        const capture = (width: number, height: number, visible: boolean) => ({
            viewport: { width, height },
            root: node('root', width, height, [
                node('region', visible ? width - 24 : 0, visible ? height - 12 : 0, [], {
                    display: visible ? 'flex' : 'none', marginTop: visible ? '12px' : '0px',
                }),
            ]),
        });
        const result = reconcileResponsiveConstraints([
            capture(280, 248, false), capture(280, 800, true), capture(600, 800, true),
        ]);
        const region = result.constraints.get('region');
        expect(region?.visibility).toEqual([
            { visible: false, structural: false, transitionToNext: {
                lowerBound: 248, upperBound: 800, confidence: 'bounded', axis: 'height',
            } },
            { visible: true, structural: false },
        ]);
        expect(region?.layoutVariants[0].transitionToNext).toEqual({
            lowerBound: 248, upperBound: 800, confidence: 'bounded', axis: 'height',
        });
        expect(region?.layoutVariants[0].computedStyleLiterals).toEqual({ marginTop: '0px' });
        expect(region?.layoutVariants[1].computedStyleLiterals).toEqual({ marginTop: '12px' });
        expect(region?.horizontal).toMatchObject({ kind: 'fill', offset: -24 });
    });

    test('keeps exact width breakpoints measurable when each width has multiple heights', () => {
        const capture = (width: number, height: number) => ({
            viewport: { width, height },
            root: node('root', width, height, width < 768
                ? [node('main', width - 24, height - 12)]
                : [node('sidebar', 280, height - 12), node('main', width - 292, height - 12)]),
        });
        const captures = [420, 800].flatMap((height) =>
            [766, 767, 768, 769].map((width) => capture(width, height)));
        const result = reconcileResponsiveConstraints(captures);
        expect(result.constraints.get('main')?.horizontalVariants).toEqual([
            { constraint: expect.objectContaining({ kind: 'fill', offset: -24 }),
                transitionToNext: { lowerBound: 767, upperBound: 768, confidence: 'measured' } },
            { constraint: expect.objectContaining({ kind: 'fill', offset: -292 }) },
        ]);
        expect(result.constraints.get('main')?.vertical).toMatchObject({ kind: 'fill', offset: -12 });
    });

    test('qualifies vertical sizing models by measured width breakpoints', () => {
        const capture = (width: number, height: number) => ({
            viewport: { width, height },
            root: node('root', width, height, [node('composer', width - 24, width < 640 ? 186 : 112)]),
        });
        const result = reconcileResponsiveConstraints([
            capture(280, 248), capture(280, 420), capture(639, 800),
            capture(640, 800), capture(641, 800), capture(1200, 420), capture(1200, 800),
        ]);
        expect(result.constraints.get('composer')?.verticalVariants).toEqual([
            { constraint: expect.objectContaining({ kind: 'fixed', value: 186 }),
                transitionToNext: { lowerBound: 639, upperBound: 640,
                    confidence: 'measured', axis: 'width' } },
            { constraint: expect.objectContaining({ kind: 'fixed', value: 112 }) },
        ]);
    });

    test('derives each vertical width band from one same-width height slice', () => {
        const capture = (width: number, height: number, composerHeight: number) => ({
            viewport: { width, height },
            root: node('root', width, height, [node('composer', width - 24, composerHeight)]),
        });
        const result = reconcileResponsiveConstraints([
            capture(280, 248, 214.5), capture(280, 420, 214.5), capture(280, 800, 214.5),
            capture(639, 420, 140.5), capture(639, 800, 140.5),
            capture(640, 420, 160.5), capture(640, 800, 160.5),
            capture(767, 420, 160.5), capture(767, 800, 160.5),
            capture(768, 420, 186.5), capture(768, 800, 186.5),
            capture(1024, 420, 160.5), capture(1024, 800, 160.5),
            capture(1200, 420, 160.5), capture(1200, 800, 160.5),
        ]);
        expect(result.constraints.get('composer')?.verticalVariants?.map((variant) =>
            variant.constraint.value)).toEqual([214.5, 140.5, 160.5, 186.5, 160.5]);
    });

    test('rejects only duplicate viewport dimensions, not duplicate widths', () => {
        const capture = (height: number) => ({ viewport: { width: 280, height }, root: node('root', 280, height) });
        expect(() => reconcileResponsiveConstraints([capture(248), capture(420), capture(420)]))
            .toThrow('responsive viewport dimensions must be unique');
    });

    test('infers fixed, fill, proportional and visibility breakpoint models', () => {
        const capture = (viewport: number) => {
            const hidden = viewport < 700;
            return {
                viewport: { width: viewport, height: 600 },
                root: node('root', viewport, 600, [
                    node('fixed', 200, 40),
                    node('fill', viewport - 40, 50),
                    node('half', viewport * 0.5, 60),
                    node('sidebar', hidden ? 0 : 240, hidden ? 0 : 600, [], { display: hidden ? 'none' : 'flex' }),
                ]),
            };
        };
        const result = reconcileResponsiveConstraints([capture(640), capture(800), capture(1200)]);
        expect(result.constraints.get('fixed')?.horizontal?.kind).toBe('fixed');
        expect(result.constraints.get('fill')?.horizontal).toMatchObject({ kind: 'fill', offset: -40 });
        expect(result.constraints.get('half')?.horizontal).toMatchObject({ kind: 'proportional', ratio: 0.5 });
        expect(result.constraints.get('sidebar')?.visibility).toEqual([
            { visible: false, structural: false, transitionToNext: { lowerBound: 640, upperBound: 800, confidence: 'bounded' } },
            { visible: true, structural: false },
        ]);
        expect(result.diagnostics).toContainEqual(expect.objectContaining({
            sourceId: 'sidebar', code: 'bounded-breakpoint', severity: 'warning',
        }));
    });

    test('models monotonic conditional rendering as a bounded structural variant', () => {
        const wide = { viewport: { width: 1000, height: 600 }, root: node('root', 1000, 600, [node('conditional', 100, 20)]) };
        const mid = { viewport: { width: 800, height: 600 }, root: node('root', 800, 600) };
        const small = { viewport: { width: 600, height: 600 }, root: node('root', 600, 600) };
        const result = reconcileResponsiveConstraints([wide, mid, small]);
        expect(result.constraints.get('conditional')?.visibility).toEqual([
            { visible: false, structural: true, transitionToNext: { lowerBound: 800, upperBound: 1000, confidence: 'bounded' } },
            { visible: true, structural: false },
        ]);
        expect(result.matchReport.structuralVariants).toBe(1);
        expect(result.diagnostics).toContainEqual(expect.objectContaining({
            sourceId: 'conditional', code: 'bounded-breakpoint', severity: 'error',
        }));
    });

    test('rejects a bounded structural disappearance as well as an appearance', () => {
        const capture = (viewport: number) => ({
            viewport: { width: viewport, height: 600 },
            root: node('root', viewport, 600,
                viewport < 900 ? [node('conditional', 100, 20)] : []),
        });
        const result = reconcileResponsiveConstraints([
            capture(600), capture(800), capture(1000),
        ]);
        expect(result.constraints.get('conditional')?.visibility).toEqual([
            { visible: true, structural: false, transitionToNext: {
                lowerBound: 800, upperBound: 1000, confidence: 'bounded',
            } },
            { visible: false, structural: true },
        ]);
        expect(result.diagnostics).toContainEqual(expect.objectContaining({
            sourceId: 'conditional', code: 'bounded-breakpoint', severity: 'error',
        }));
    });

    test('reports a bounded structural subtree once at its highest changing branch', () => {
        const capture = (viewport: number) => ({
            viewport: { width: viewport, height: 600 },
            root: node('root', viewport, 600, viewport >= 900
                ? [node('panel', 200, 600, [node('child', 100, 20)])] : []),
        });
        const result = reconcileResponsiveConstraints([
            capture(600), capture(800), capture(1000),
        ]);
        expect(result.diagnostics.filter((diagnostic) =>
            diagnostic.code === 'bounded-breakpoint' && diagnostic.severity === 'error'))
            .toEqual([expect.objectContaining({ sourceId: 'panel' })]);
    });

    test('preserves canonical descendants windowed by a stable scrollable ARIA collection', () => {
        const capture = (width: number, height: number, mountsRow: boolean) => {
            const row = node('row', width - 24, 32);
            const log = node('log', width - 24, height - 20, mountsRow ? [row] : [], {
                overflowY: 'auto',
            });
            log.attributes = { role: 'log' };
            return { viewport: { width, height }, root: node('root', width, height, [log]) };
        };
        const result = reconcileResponsiveConstraints([
            capture(600, 400, false), capture(600, 800, true), capture(1200, 800, true),
        ]);
        expect(result.constraints.get('row')?.visibility).toEqual([
            { visible: true, structural: false },
        ]);
        expect(result.constraints.get('log')?.layoutVariants).toEqual([
            expect.objectContaining({ childOrder: ['row'] }),
        ]);
        expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
            sourceId: 'row', code: 'bounded-breakpoint',
        }));
    });

    test('unions exact structural branches without viewport-history-dependent identity', () => {
        const capture = (viewport: number) => ({
            viewport: { width: viewport, height: 600 },
            root: node('root', viewport, 600, viewport < 700
                ? [node('compact', viewport, 600)] : [node('expanded', viewport, 600)]),
        });
        const captures = [capture(699), capture(700), capture(701)];
        const reconciliation = reconcileResponsiveConstraints(captures);
        const union = unionResponsiveTrees(captures.map((item) => lowerObservedDom(item.root, '2026-01-01T00:00:00Z')), reconciliation);
        expect(union.children.map((child) => child.source_node_id)).toEqual(['expanded', 'compact']);
        expect(union.children[1].responsive?.visibility).toEqual([
            { visible: true, structural: false, transitionToNext: { lowerBound: 699, upperBound: 700, confidence: 'measured' } },
            { visible: false, structural: true },
        ]);
        expect(union.children[0].responsive?.visibility).toEqual([
            { visible: false, structural: true, transitionToNext: { lowerBound: 699, upperBound: 700, confidence: 'measured' } },
            { visible: true, structural: false },
        ]);
    });

    test('records structural child order at the exact sidebar breakpoint', () => {
        const capture = (viewport: number) => ({
            viewport: { width: viewport, height: 600 },
            root: node('root', viewport, 600, viewport < 768
                ? [node('main', viewport, 600), node('toggle', 20, 20)]
                : [node('sidebar', 280, 600), node('main', viewport - 280, 600), node('toggle', 20, 20)]),
        });
        const captures = [capture(767), capture(768), capture(1200)];
        const reconciliation = reconcileResponsiveConstraints(captures);
        expect(reconciliation.constraints.get('root')?.layoutVariants).toEqual([
            { childOrder: ['main', 'toggle'], flexDirection: 'row', flexWrap: 'nowrap', reflowed: false,
                transitionToNext: { lowerBound: 767, upperBound: 768, confidence: 'measured' } },
            { childOrder: ['sidebar', 'main', 'toggle'], flexDirection: 'row', flexWrap: 'nowrap', reflowed: false },
        ]);
        const union = unionResponsiveTrees(captures.map((item) => lowerObservedDom(item.root, 'now')), reconciliation);
        expect(union.children.map((child) => child.source_node_id)).toEqual(['sidebar', 'main', 'toggle']);
    });

    test('segments child geometry at exact structural breakpoints', () => {
        const capture = (viewport: number) => {
            const wide = viewport >= 768;
            const mainWidth = wide ? viewport - 292 : viewport - 24;
            return {
                viewport: { width: viewport, height: 600 },
                root: node('root', viewport, 600, wide
                    ? [node('sidebar', 280, 600), node('main', mainWidth, 600)]
                    : [node('main', mainWidth, 600)]),
            };
        };
        const result = reconcileResponsiveConstraints([capture(599), capture(767), capture(768), capture(1200)]);
        expect(result.constraints.get('main')?.horizontalVariants).toEqual([
            { constraint: expect.objectContaining({ kind: 'fill', offset: -24 }),
                transitionToNext: { lowerBound: 767, upperBound: 768, confidence: 'measured' } },
            { constraint: expect.objectContaining({ kind: 'fill', offset: -292 }) },
        ]);
    });

    test('records computed layout literals at an exact width boundary without freezing size', () => {
        const capture = (viewport: number) => ({
            viewport: { width: viewport, height: 600 },
            root: node('root', viewport, 600, [
                node('content', viewport - 20, 400, [], {
                    marginLeft: viewport < 768 ? '4px' : '12px',
                    paddingLeft: '8px', overflowY: 'auto',
                }),
            ]),
        });
        const result = reconcileResponsiveConstraints([capture(600), capture(767), capture(768), capture(1200)]);
        const content = result.constraints.get('content');
        expect(content?.horizontal).toMatchObject({ kind: 'fill', offset: -20 });
        expect(content?.layoutVariants).toEqual([
            { childOrder: [], flexDirection: 'row', flexWrap: 'nowrap', reflowed: false,
                computedStyleLiterals: { marginLeft: '4px' },
                transitionToNext: { lowerBound: 767, upperBound: 768, confidence: 'measured' } },
            { childOrder: [], flexDirection: 'row', flexWrap: 'nowrap', reflowed: false,
                computedStyleLiterals: { marginLeft: '12px' } },
        ]);
    });

    test('records responsive text layout properties at an exact width boundary', () => {
        const capture = (viewport: number) => ({
            viewport: { width: viewport, height: 600 },
            root: node('root', viewport, 600, [
                node('model-label', 100, 18, [], {
                    display: 'block',
                    whiteSpace: viewport < 600 ? 'normal' : 'nowrap',
                    textOverflow: viewport < 600 ? 'clip' : 'ellipsis',
                    overflowWrap: 'normal',
                }),
            ]),
        });
        const result = reconcileResponsiveConstraints([
            capture(280), capture(599), capture(600), capture(1200),
        ]);
        expect(result.constraints.get('model-label')?.layoutVariants).toEqual([
            { childOrder: [], reflowed: false,
                computedStyleLiterals: { whiteSpace: 'normal', textOverflow: 'clip' },
                transitionToNext: { lowerBound: 599, upperBound: 600, confidence: 'measured' } },
            { childOrder: [], reflowed: false,
                computedStyleLiterals: { whiteSpace: 'nowrap', textOverflow: 'ellipsis' } },
        ]);
    });

    test('does not freeze a fluid terminal segment sampled only at W and W+1', () => {
        const capture = (viewport: number) => ({
            viewport: { width: viewport, height: 600 },
            root: node('root', viewport, 600, [
                node('main', viewport >= 768 ? viewport - 292 : viewport - 24, 600),
                ...(viewport >= 1024 ? [node('unrelated-breakpoint-child', 20, 20)] : []),
            ]),
        });
        const result = reconcileResponsiveConstraints([
            capture(767), capture(768), capture(769), capture(1023), capture(1024), capture(1025),
        ]);
        expect(result.constraints.get('main')?.horizontalVariants?.at(-1)?.constraint)
            .toMatchObject({ kind: 'fill', offset: -292, residual: 0 });
    });

    test('uses captured max-width to infer a fluid clamp from unclamped samples', () => {
        const capture = (viewport: number) => ({
            viewport: { width: viewport, height: 600 },
            root: node('root', viewport, 600, [
                node('composer', Math.min(viewport - 24, 896), 120, [], { maxWidth: '896px' }),
            ]),
        });
        const result = reconcileResponsiveConstraints([
            capture(600), capture(768), capture(1024), capture(1200), capture(1400),
        ]);
        expect(result.constraints.get('composer')?.horizontal)
            .toMatchObject({ kind: 'max', max: 896, ratio: 1, offset: -24, residual: 0 });
    });

    test('retains an exact horizontal model when the vertical axis is ambiguous', () => {
        const heights = [100, 140, 103, 177];
        const captures = [599, 767, 768, 1200].map((viewport, index) => ({
            viewport: { width: viewport, height: 800 },
            root: node('root', viewport, 800, [node('content', viewport - 24, heights[index])]),
        }));
        const result = reconcileResponsiveConstraints(captures);
        expect(result.constraints.get('content')?.horizontal).toMatchObject({ kind: 'fill', offset: -24 });
        expect(result.constraints.get('content')?.vertical).toBeUndefined();
        expect(result.diagnostics).toContainEqual(expect.objectContaining({
            sourceId: 'content', code: 'ambiguous-axis', message: expect.stringContaining('vertical:'),
        }));
    });

    test('aligns path index drift under a stable source attribute', () => {
        const narrow = node('root', 599, 600, [node('root/main[content]:1', 599, 600)]);
        narrow.children[0].attributes['data-slot'] = 'content';
        const wide = node('root', 1200, 600, [node('root/aside:1', 240, 600), node('root/main[content]:2', 960, 600)]);
        wide.children[1].attributes['data-slot'] = 'content';
        const aligned = alignStableObservedDomIdentities([
            { viewport: { width: 599, height: 600 }, root: narrow },
            { viewport: { width: 1200, height: 600 }, root: wide },
        ]);
        expect(aligned[0].root.children[0].sourceId).toBe('root/main[content]:2');
    });

    test('merges one stable node across every width without an index duplicate', () => {
        const capture = (width: number, prefix: boolean) => {
            const content = node(`root/main[content]:${prefix ? 2 : 1}`, width - (prefix ? 240 : 0), 600);
            content.attributes['data-slot'] = 'content';
            return { viewport: { width, height: 600 }, root: node('root', width, 600,
                prefix ? [node('root/aside:1', 240, 600), content] : [content]) };
        };
        const aligned = alignStableObservedDomIdentities([
            capture(599, false), capture(768, true), capture(1200, true),
        ]);
        const ids = aligned.map(({ root }) => root.children.find((child) => child.attributes['data-slot'] === 'content')!.sourceId);
        expect(new Set(ids)).toEqual(new Set(['root/main[content]:2']));
        const result = reconcileResponsiveConstraints(aligned);
        expect(new Set(result.diagnostics.filter((item) => item.sourceId.includes('main[content]'))
            .map((item) => item.sourceId))).toEqual(new Set(['root/main[content]:2']));
    });

    test('preserves canonical repeated slots and reports ambiguous legacy collisions', () => {
        const item = (id: string) => {
            const value = node(id, 100, 20);
            value.attributes['data-slot'] = 'sidebar-menu-button';
            return value;
        };
        const canonical = alignStableObservedDomIdentitiesWithReport([
            { viewport: { width: 600, height: 600 }, root: node('dom/root:0', 600, 600, [item('dom/root:0/item-a:0'), item('dom/root:0/item-b:0')]) },
            { viewport: { width: 1200, height: 600 }, root: node('dom/root:0', 1200, 600, [item('dom/root:0/item-b:0'), item('dom/root:0/item-a:0')]) },
        ]);
        expect(canonical.captures[0].root.children.map((child) => child.sourceId)).toEqual(['dom/root:0/item-a:0', 'dom/root:0/item-b:0']);
        expect(canonical.captures[1].root.children.map((child) => child.sourceId)).toEqual(['dom/root:0/item-b:0', 'dom/root:0/item-a:0']);
        expect(canonical.report.collisions).toBeGreaterThan(0);
        expect(canonical.report.refusedCollisions).toBe(canonical.report.collisions);
        expect(canonical.report.collisionCategories['data-slot']).toBe(canonical.report.collisions);

        const legacy = alignStableObservedDomIdentitiesWithReport([
            { viewport: { width: 600, height: 600 }, root: node('root', 600, 600, [item('root/button:1'), item('root/button:2')]) },
            { viewport: { width: 1200, height: 600 }, root: node('root', 1200, 600, [item('root/button:2'), item('root/button:3')]) },
        ]);
        expect(legacy.captures[0].root.children.map((child) => child.sourceId)).toEqual(['root/button:1', 'root/button:2']);
        expect(legacy.report.aligned).toBe(0);
        expect(legacy.report.collisions).toBeGreaterThanOrEqual(4);
        expect(legacy.report.refusedCollisions).toBe(legacy.report.collisions);
    });
});

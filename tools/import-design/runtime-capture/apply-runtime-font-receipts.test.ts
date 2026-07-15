import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('projects runtime platform faces used only by attributed text runs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pulp-font-runs-'));
    const capture = join(directory, 'capture.json');
    const native = join(directory, 'native.json');
    const output = join(directory, 'output.json');
    writeFileSync(capture, JSON.stringify({
        observedDom: { sourceId: 'root', children: [{
            sourceId: 'bold-code',
            usedFonts: [{ family: 'Menlo', postScriptName: 'Menlo-Bold', custom: false, glyphCount: 4 }],
        }] },
        usedFaces: [{ family: 'Menlo', postScriptName: 'Menlo-Bold', custom: false, glyphCount: 4,
            evidence: { sourceId: 'bold-code' } }],
    }));
    writeFileSync(native, JSON.stringify({
        root: { source_node_id: 'root', style: { fontFamily: 'system-ui' }, textRuns: [{
            fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 600, fontStyle: 'normal',
        }], children: [] },
        diagnostics: [], fontFamilyAssets: [],
    }));
    const completed = Bun.spawnSync([
        process.execPath, import.meta.dir + '/apply-runtime-font-receipts.ts',
        '--capture', capture, '--native', native, '--output', output,
    ]);
    expect(completed.exitCode).toBe(0);
    const projected = JSON.parse(readFileSync(output, 'utf8'));
    expect(projected.root.textRuns[0].fontFamily).toBe('ui-monospace, Menlo, monospace');
    expect(projected.fontFamilyAssets).toContainEqual(expect.objectContaining({
        family: 'Menlo', weight: 600, style: 'normal', platform_face: 'Menlo-Bold',
    }));
});

test('projects the captured runtime family and exact platform face across root-state hash churn', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pulp-font-platform-face-'));
    const capture = join(directory, 'capture.json');
    const native = join(directory, 'native.json');
    const output = join(directory, 'output.json');
    writeFileSync(capture, JSON.stringify({
        observedDom: { sourceId: 'dom/html-shape-light:0', children: [{
            sourceId: 'dom/html-shape-light:0/body-shape-light:0/div-id-root:0/span-shape-model:0',
            usedFonts: [{ family: '.SF NS', postScriptName: '.SFNS-Exact-Receipt', custom: false, glyphCount: 10 }],
        }] },
    }));
    writeFileSync(native, JSON.stringify({
        root: { source_node_id: 'dom/html-shape-dark:0', children: [{
            source_node_id: 'dom/html-shape-dark:0/body-shape-dark:0/div-id-root:0/span-shape-model:0::text:1',
            style: { fontFamily: '.SF NS', fontWeight: 500, fontStyle: 'normal' },
            raw_source: JSON.stringify({ computedStyle: {
                fontFamily: '-apple-system, system-ui, sans-serif',
            } }),
            children: [],
        }] },
        diagnostics: [], fontFamilyAssets: [],
    }));
    const completed = Bun.spawnSync([
        process.execPath, import.meta.dir + '/apply-runtime-font-receipts.ts',
        '--capture', capture, '--native', native, '--output', output,
    ]);
    expect(completed.exitCode).toBe(0);
    const projected = JSON.parse(readFileSync(output, 'utf8'));
    expect(projected.root.children[0].style.fontFamily).toBe('-apple-system, system-ui, sans-serif');
    expect(projected.fontFamilyAssets).toContainEqual(expect.objectContaining({
        family: '.SF NS', weight: 500, platform_face: '.SFNS-Exact-Receipt',
        css_alias: '-apple-system, system-ui, sans-serif', glyph_count: 10,
        primary_runtime_face: true,
    }));
});

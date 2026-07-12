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
    expect(projected.root.textRuns[0].fontFamily).toBe('Menlo');
    expect(projected.fontFamilyAssets).toContainEqual(expect.objectContaining({
        family: 'Menlo', weight: 600, style: 'normal', platform_face: 'Menlo-Bold',
    }));
});

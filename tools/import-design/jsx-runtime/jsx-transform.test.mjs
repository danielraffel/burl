import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const transform = join(here, 'jsx-transform.mjs');

function run(args) {
    return spawnSync(process.execPath, [transform, ...args], {
        cwd: here,
        encoding: 'utf8',
    });
}

test('bundles a named component export through a tsconfig path alias', () => {
    const project = mkdtempSync(join(tmpdir(), 'pulp-jsx-transform-'));
    const src = join(project, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            jsx: 'react-jsx',
            moduleResolution: 'bundler',
            paths: { '@fixture/*': ['./src/*'] },
        },
    }));
    writeFileSync(join(src, 'label.ts'), 'export const label: string = "ALIASED MODULE GRAPH";\n');
    writeFileSync(join(src, 'Panel.tsx'), `
        import { useState } from 'react';
        import { label } from '@fixture/label';
        export function NamedPanel() {
            const [count] = useState(2);
            return <div>{label}: {count}</div>;
        }
    `);

    const output = join(project, 'bundle.js');
    const result = run([
        '--in', join(src, 'Panel.tsx'),
        '--out', output,
        '--export', 'NamedPanel',
        '--tsconfig', join(project, 'tsconfig.json'),
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, 'utf8'), /ALIASED MODULE GRAPH/);
    const manifest = JSON.parse(readFileSync(`${output}.manifest.json`, 'utf8'));
    assert.equal(manifest.componentName, 'NamedPanel');
    assert.equal(manifest.exportName, 'NamedPanel');
    assert.equal(manifest.tsconfigFile, resolve(project, 'tsconfig.json'));
});

test('keeps the default export behavior when no export option is supplied', () => {
    const project = mkdtempSync(join(tmpdir(), 'pulp-jsx-transform-default-'));
    const input = join(project, 'DefaultPanel.jsx');
    const output = join(project, 'bundle.js');
    writeFileSync(input, 'export default function DefaultPanel() { return <div>DEFAULT EXPORT</div>; }\n');

    const result = run(['--in', input, '--out', output]);

    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(`${output}.manifest.json`, 'utf8'));
    assert.equal(manifest.componentName, 'DefaultPanel');
    assert.equal(manifest.exportName, 'default');
    assert.equal(manifest.tsconfigFile, null);
});

test('fails clearly when the explicit tsconfig cannot be read', () => {
    const project = mkdtempSync(join(tmpdir(), 'pulp-jsx-transform-missing-config-'));
    const input = join(project, 'Panel.tsx');
    writeFileSync(input, 'export function Panel() { return <div />; }\n');

    const result = run([
        '--in', input,
        '--out', join(project, 'bundle.js'),
        '--export', 'Panel',
        '--tsconfig', join(project, 'missing.json'),
    ]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /cannot read tsconfig/);
});

test('fails at bundle time when the selected named export does not exist', () => {
    const project = mkdtempSync(join(tmpdir(), 'pulp-jsx-transform-missing-export-'));
    const input = join(project, 'Panel.tsx');
    writeFileSync(input, 'export function Panel() { return <div />; }\n');

    const result = run([
        '--in', input,
        '--out', join(project, 'bundle.js'),
        '--export', 'MissingPanel',
    ]);

    assert.equal(result.status, 5);
    assert.match(result.stderr, /No matching export.*MissingPanel/);
});

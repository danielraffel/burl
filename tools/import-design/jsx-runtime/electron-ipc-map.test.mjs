import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildElectronIpcMap } from './electron-ipc-map.mjs';

function fixture(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-ipc-map-'));
    for (const [relative, source] of Object.entries(files)) {
        const target = path.join(root, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, source);
    }
    return root;
}

test('maps nested contextBridge APIs to handlers across modules with provenance', () => {
    const root = fixture({
        'preload.ts': `import { contextBridge as bridge, ipcRenderer as ipc } from 'electron';\nbridge.exposeInMainWorld('app', { files: { open: (p: string) => ipc.invoke('files:open', p) }, events: { onDone: (fn: Function) => ipc.on('files:done', fn) } });\n`,
        'main/files.ts': `import { ipcMain as bus } from 'electron';\nbus.handle('files:open', async () => true);\n`,
        'main/events.ts': `const { ipcMain: main } = require('electron');\nmain.on('other:event', () => {});\nwin.webContents.send('files:done');\n`,
    });
    const report = buildElectronIpcMap({ root, preload: ['preload.ts'], revision: 'abc123' });
    assert.equal(report.verdict, 'pass');
    assert.deepEqual(report.mappings.map((entry) => [entry.api, entry.channel, entry.main[0].file]), [
        ['app.events.onDone', 'files:done', 'main/events.ts'],
        ['app.files.open', 'files:open', 'main/files.ts'],
    ]);
    assert.match(report.mappings[0].renderer.fileSha256, /^[a-f0-9]{64}$/);
    assert.match(report.mappings[0].renderer.siteSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.source.revision, 'abc123');
});

test('fails closed for computed channels and missing handlers', () => {
    const root = fixture({
        'preload.ts': `import { contextBridge, ipcRenderer } from 'electron';\nconst channel = 'unsafe';\ncontextBridge.exposeInMainWorld('app', { dynamic: () => ipcRenderer.invoke(channel), missing: () => ipcRenderer.send('missing') });\n`,
        'main.ts': `import { ipcMain } from 'electron';\nconst channel = 'unsafe';\nipcMain.handle(channel, () => null);\n`,
    });
    const report = buildElectronIpcMap({ root, preload: ['preload.ts'] });
    assert.equal(report.verdict, 'fail');
    assert.equal(report.summary.dynamicSites, 2);
    assert.equal(report.summary.missingMainHandlers, 1);
    assert.equal(report.mappings[0].status, 'missing-main-handler');
    assert.deepEqual(new Set(report.unresolved.map((entry) => entry.side)), new Set(['renderer', 'main']));
});

test('output model is deterministic regardless of directory creation order', () => {
    const files = {
        'z/main.ts': `import { ipcMain } from 'electron'; ipcMain.handle('x', () => 1);`,
        'a/preload.ts': `import { contextBridge, ipcRenderer } from 'electron'; contextBridge.exposeInMainWorld('api', { x: () => ipcRenderer.invoke('x') });`,
    };
    const first = fixture(files);
    const second = fixture(Object.fromEntries(Object.entries(files).reverse()));
    const normalize = (report) => ({ ...report, source: { ...report.source, rootLabel: 'fixture' } });
    assert.deepEqual(normalize(buildElectronIpcMap({ root: first, preload: ['a/preload.ts'] })), normalize(buildElectronIpcMap({ root: second, preload: ['a/preload.ts'] })));
});

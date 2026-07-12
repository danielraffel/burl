#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { parse } from '@babel/parser';

const require = createRequire(import.meta.url);
const SCHEMA = 'burl-electron-ipc-map-v1';
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const RENDERER_METHODS = new Set(['invoke', 'send', 'sendSync', 'on', 'once', 'removeListener', 'removeAllListeners']);
const MAIN_METHODS = new Set(['handle', 'handleOnce', 'on', 'once', 'removeHandler', 'removeAllListeners']);
const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'extra', 'errors', 'comments', 'leadingComments', 'innerComments', 'trailingComments']);

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
    const args = { root: '', preload: [], out: '', revision: '', allowDynamic: false };
    for (let i = 2; i < argv.length; i += 1) {
        const value = argv[i + 1];
        if (argv[i] === '--root') { args.root = value; i += 1; }
        else if (argv[i] === '--preload') { args.preload.push(value); i += 1; }
        else if (argv[i] === '--out') { args.out = value; i += 1; }
        else if (argv[i] === '--source-revision') { args.revision = value; i += 1; }
        else if (argv[i] === '--allow-dynamic') args.allowDynamic = true;
        else if (argv[i] === '--help' || argv[i] === '-h') {
            console.log('Usage: electron-ipc-map.mjs --root DIR --preload FILE [--preload FILE ...] --out FILE [--source-revision SHA] [--allow-dynamic]');
            process.exit(0);
        } else throw new Error(`unknown argument: ${argv[i]}`);
    }
    if (!args.root || !args.preload.length || !args.out) throw new Error('--root, --preload, and --out are required');
    return args;
}

function walkFiles(root) {
    const out = [];
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build' || entry.name === 'out') continue;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(absolute);
            else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) out.push(absolute);
        }
    }
    visit(root);
    return out;
}

function parseFile(filename, root) {
    const source = fs.readFileSync(filename, 'utf8');
    const ast = parse(source, {
        sourceType: 'unambiguous',
        errorRecovery: false,
        plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties', 'dynamicImport', 'importAttributes'],
    });
    return { filename, relative: path.relative(root, filename).split(path.sep).join('/'), source, ast, fileHash: sha256(source) };
}

function visit(node, callback, parent = null) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') callback(node, parent);
    for (const [key, value] of Object.entries(node)) {
        if (SKIP_KEYS.has(key) || !value) continue;
        if (Array.isArray(value)) for (const child of value) visit(child, callback, node);
        else if (typeof value === 'object') visit(value, callback, node);
    }
}

function importedElectronBindings(ast) {
    const bindings = { contextBridge: new Set(), ipcRenderer: new Set(), ipcMain: new Set() };
    for (const statement of ast.program.body) {
        if (statement.type !== 'ImportDeclaration' || statement.source.value !== 'electron') continue;
        for (const specifier of statement.specifiers) {
            if (specifier.type !== 'ImportSpecifier') continue;
            const imported = specifier.imported.name || specifier.imported.value;
            if (bindings[imported]) bindings[imported].add(specifier.local.name);
        }
    }
    visit(ast, (node) => {
        if (node.type !== 'VariableDeclarator' || node.init?.type !== 'CallExpression') return;
        if (node.init.callee?.name !== 'require' || node.init.arguments?.[0]?.value !== 'electron' || node.id?.type !== 'ObjectPattern') return;
        for (const property of node.id.properties) {
            const imported = property.key?.name;
            const local = property.value?.name;
            if (bindings[imported] && local) bindings[imported].add(local);
        }
    });
    return bindings;
}

function memberCall(node, owners, methods) {
    if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression' || node.callee.computed) return null;
    const owner = node.callee.object;
    const method = node.callee.property?.name;
    if (owner?.type !== 'Identifier' || !owners.has(owner.name) || !methods.has(method)) return null;
    return { method, argument: node.arguments[0] };
}

function literalString(node) {
    if (node?.type === 'StringLiteral') return node.value;
    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
    return null;
}

function propertyName(property) {
    if (property.computed) return literalString(property.key);
    return property.key?.name ?? property.key?.value ?? null;
}

function location(parsed, node) {
    const start = node.loc?.start ?? { line: null, column: null };
    const end = node.loc?.end ?? { line: null, column: null };
    const snippet = parsed.source.slice(node.start, node.end);
    return {
        file: parsed.relative,
        line: start.line,
        column: start.column,
        endLine: end.line,
        endColumn: end.column,
        fileSha256: parsed.fileHash,
        siteSha256: sha256(snippet),
    };
}

function rendererSites(parsed) {
    const bindings = importedElectronBindings(parsed.ast);
    const exposed = [];
    const unresolved = [];
    visit(parsed.ast, (node) => {
        if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression' || node.callee.computed) return;
        if (node.callee.property?.name !== 'exposeInMainWorld' || node.callee.object?.type !== 'Identifier' || !bindings.contextBridge.has(node.callee.object.name)) return;
        const world = literalString(node.arguments[0]);
        const object = node.arguments[1];
        if (!world || object?.type !== 'ObjectExpression') {
            unresolved.push({ side: 'preload', reason: 'dynamic-context-bridge-exposure', ...location(parsed, node) });
            return;
        }
        function collect(value, segments) {
            if (value?.type === 'ObjectExpression') {
                for (const property of value.properties) {
                    if (property.type !== 'ObjectProperty' && property.type !== 'ObjectMethod') {
                        unresolved.push({ side: 'preload', reason: 'dynamic-api-shape', api: [world, ...segments].join('.'), ...location(parsed, property) });
                        continue;
                    }
                    const name = propertyName(property);
                    if (!name) {
                        unresolved.push({ side: 'preload', reason: 'dynamic-api-property', api: [world, ...segments].join('.'), ...location(parsed, property) });
                        continue;
                    }
                    collect(property.type === 'ObjectMethod' ? property : property.value, [...segments, name]);
                }
                return;
            }
            let found = false;
            visit(value, (candidate) => {
                const call = memberCall(candidate, bindings.ipcRenderer, RENDERER_METHODS);
                if (!call) return;
                found = true;
                const channel = literalString(call.argument);
                const base = { api: [world, ...segments].join('.'), transport: call.method, ...location(parsed, candidate) };
                if (channel === null) unresolved.push({ side: 'renderer', reason: 'dynamic-channel', ...base });
                else exposed.push({ channel, ...base });
            });
            if (!found && segments.length) exposed.push({ api: [world, ...segments].join('.'), transport: null, channel: null, ...location(parsed, value) });
        }
        collect(object, []);
    });
    return { exposed, unresolved };
}

function mainSites(parsed) {
    const bindings = importedElectronBindings(parsed.ast);
    const sites = [];
    const unresolved = [];
    visit(parsed.ast, (node) => {
        const call = memberCall(node, bindings.ipcMain, MAIN_METHODS);
        if (!call) return;
        const channel = literalString(call.argument);
        const base = { transport: call.method, ...location(parsed, node) };
        if (channel === null) unresolved.push({ side: 'main', reason: 'dynamic-channel', ...base });
        else sites.push({ channel, ...base });
    });
    return { sites, unresolved };
}

function mainEmitSites(parsed) {
    const sites = [];
    const unresolved = [];
    visit(parsed.ast, (node) => {
        if ((node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') ||
            (node.callee?.type !== 'MemberExpression' && node.callee?.type !== 'OptionalMemberExpression') ||
            node.callee.computed || node.callee.property?.name !== 'send') return;
        const owner = node.callee.object;
        const isMember = owner?.type === 'MemberExpression' || owner?.type === 'OptionalMemberExpression';
        const isWebContents = isMember && !owner.computed && owner.property?.name === 'webContents';
        const isSender = isMember && !owner.computed && owner.property?.name === 'sender';
        if (!isWebContents && !isSender) return;
        const channel = literalString(node.arguments[0]);
        const base = { transport: 'webContents.send', ...location(parsed, node) };
        if (channel === null) unresolved.push({ side: 'main-emitter', reason: 'dynamic-channel', ...base });
        else sites.push({ channel, ...base });
    });
    return { sites, unresolved };
}

export function buildElectronIpcMap({ root, preload, revision = '' }) {
    const absoluteRoot = path.resolve(root);
    const preloadSet = new Set(preload.map((value) => path.resolve(absoluteRoot, value)));
    const files = walkFiles(absoluteRoot).map((filename) => parseFile(filename, absoluteRoot));
    const renderer = { exposed: [], unresolved: [] };
    const main = { sites: [], emits: [], unresolved: [] };
    for (const parsed of files) {
        if (preloadSet.has(parsed.filename)) {
            const result = rendererSites(parsed);
            renderer.exposed.push(...result.exposed);
            renderer.unresolved.push(...result.unresolved);
        }
        const result = mainSites(parsed);
        main.sites.push(...result.sites);
        main.unresolved.push(...result.unresolved);
        const emits = mainEmitSites(parsed);
        main.emits.push(...emits.sites);
        main.unresolved.push(...emits.unresolved);
    }
    const compare = (a, b) => JSON.stringify([a.channel, a.api, a.file, a.line, a.column]).localeCompare(JSON.stringify([b.channel, b.api, b.file, b.line, b.column]));
    renderer.exposed.sort(compare);
    renderer.unresolved.sort(compare);
    main.sites.sort(compare);
    main.emits.sort(compare);
    main.unresolved.sort(compare);
    const implementations = new Map();
    for (const site of main.sites) {
        if (!implementations.has(site.channel)) implementations.set(site.channel, []);
        implementations.get(site.channel).push(site);
    }
    const emissions = new Map();
    for (const site of main.emits) {
        if (!emissions.has(site.channel)) emissions.set(site.channel, []);
        emissions.get(site.channel).push(site);
    }
    const subscriptionMethods = new Set(['on', 'once', 'removeListener', 'removeAllListeners']);
    const mappings = renderer.exposed.filter((site) => site.channel !== null).map((site) => ({
        api: site.api,
        channel: site.channel,
        rendererTransport: site.transport,
        renderer: { file: site.file, line: site.line, column: site.column, endLine: site.endLine, endColumn: site.endColumn, fileSha256: site.fileSha256, siteSha256: site.siteSha256 },
        main: subscriptionMethods.has(site.transport) ? (emissions.get(site.channel) ?? []) : (implementations.get(site.channel) ?? []),
        status: subscriptionMethods.has(site.transport)
            ? (emissions.has(site.channel) ? 'mapped-event-source' : 'missing-main-emitter')
            : (implementations.has(site.channel) ? 'mapped-handler' : 'missing-main-handler'),
    }));
    const dynamic = [...renderer.unresolved, ...main.unresolved];
    const missing = mappings.filter((entry) => !entry.status.startsWith('mapped-'));
    const orphanMain = [...main.sites, ...main.emits].filter((site) => !renderer.exposed.some((entry) => entry.channel === site.channel));
    return {
        schema: SCHEMA,
        generator: { name: 'electron-ipc-map', parser: '@babel/parser', parserVersion: require('@babel/parser/package.json').version },
        source: { revision, rootLabel: path.basename(absoluteRoot), preload: [...preloadSet].map((value) => path.relative(absoluteRoot, value).split(path.sep).join('/')).sort() },
        summary: { exposedMethods: renderer.exposed.length, mappedChannels: mappings.filter((entry) => entry.status.startsWith('mapped-')).length, missingMainHandlers: missing.length, orphanMainSites: orphanMain.length, dynamicSites: dynamic.length },
        verdict: dynamic.length || missing.length ? 'fail' : 'pass',
        mappings,
        exposedWithoutIpc: renderer.exposed.filter((entry) => entry.channel === null),
        orphanMain,
        unresolved: dynamic,
    };
}

function stableJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    try {
        const args = parseArgs(process.argv);
        const report = buildElectronIpcMap(args);
        fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
        fs.writeFileSync(args.out, stableJson(report));
        if (report.verdict === 'fail' && !args.allowDynamic) process.exitCode = 2;
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

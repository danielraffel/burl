import { describe, expect, test } from 'vitest';
import { attachSemanticRoleReceipts } from '../src/semantic-role-receipts.js';

const receipt = (role: 'paragraph' | 'strong' | 'inline-code' | 'metadata') => ({
    containerSelector: '.authored-markdown', role,
    computedStyle: {
        'font-family': 'Source Sans', 'font-size': '15px', 'font-weight': '650', color: 'rgb(1, 2, 3)',
        'background-color': 'rgb(20, 21, 22)',
        'border-top-color': 'rgb(30, 31, 32)', 'border-right-color': 'rgb(30, 31, 32)',
        'border-bottom-color': 'rgb(30, 31, 32)', 'border-left-color': 'rgb(30, 31, 32)',
        'border-top-width': '1px', 'border-right-width': '1px', 'border-bottom-width': '1px', 'border-left-width': '1px',
        'border-top-left-radius': '4px', 'border-top-right-radius': '4px',
        'border-bottom-right-radius': '4px', 'border-bottom-left-radius': '4px',
        'padding-top': '2px', 'padding-right': '6px', 'padding-bottom': '2px', 'padding-left': '6px',
    },
    method: 'authored-cascade-offscreen-clone' as const,
});

describe('semantic role receipt attachment', () => {
    test('attaches explicitly selected authored role evidence to one Markdown binding', () => {
        const root: any = { children: [{ name: 'message-text', attributes: { pulpValueKind: 'markdown' } }] };
        attachSemanticRoleReceipts(root, [receipt('strong'), receipt('inline-code')], [
            { bindingSourceId: 'message-text', containerSelector: '.authored-markdown' },
        ]);
        expect(root.children[0].attributes).toMatchObject({
            pulpMarkdownStrongFontFamily: 'Source Sans',
            pulpMarkdownStrongFontSize: '15px',
            pulpMarkdownStrongFontWeight: '650',
            pulpMarkdownStrongColor: 'rgb(1, 2, 3)',
            pulpMarkdownInlineCodeFontFamily: 'Source Sans',
            pulpMarkdownInlineCodeBackground: 'rgb(20, 21, 22)',
            pulpMarkdownInlineCodeBorderColor: 'rgb(30, 31, 32)',
            pulpMarkdownInlineCodeBorderWidth: '1px',
            pulpMarkdownInlineCodeRadius: '4px',
            pulpMarkdownInlineCodePaddingX: '6px',
            pulpMarkdownInlineCodePaddingY: '2px',
        });
    });

    test('fails closed on ambiguous, missing, and non-Markdown mappings', () => {
        const markdown: any = { name: 'message-text', attributes: { pulpValueKind: 'markdown' } };
        expect(() => attachSemanticRoleReceipts(markdown, [receipt('strong'), receipt('strong')], [
            { bindingSourceId: 'message-text', containerSelector: '.authored-markdown' },
        ])).toThrow('duplicate semantic role receipt');
        expect(() => attachSemanticRoleReceipts(markdown, [], [
            { bindingSourceId: 'message-text', containerSelector: '.authored-markdown' },
        ])).toThrow('no semantic role receipts');
        expect(() => attachSemanticRoleReceipts({ name: 'plain', attributes: {} }, [receipt('strong')], [
            { bindingSourceId: 'plain', containerSelector: '.authored-markdown' },
        ])).toThrow('is not Markdown');
        expect(() => attachSemanticRoleReceipts({}, [receipt('strong')], [
            { bindingSourceId: 'absent', containerSelector: '.authored-markdown' },
        ])).toThrow('matched 0 nodes');
    });
});

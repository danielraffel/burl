export type SemanticMarkdownRole = 'paragraph' | 'strong' | 'inline-code' | 'metadata';

export interface SemanticRoleReceipt {
    containerSelector: string;
    role: SemanticMarkdownRole;
    computedStyle: Record<string, string>;
    method: 'authored-cascade-offscreen-clone';
}

export interface SemanticRoleBinding {
    bindingSourceId: string;
    containerSelector: string;
}

interface NativeNode {
    name?: string;
    attributes?: Record<string, string>;
    children?: NativeNode[];
}

const rolePrefix: Record<SemanticMarkdownRole, string> = {
    paragraph: 'Paragraph',
    strong: 'Strong',
    'inline-code': 'InlineCode',
    metadata: 'Metadata',
};

export function attachSemanticRoleReceipts(
    root: NativeNode,
    receipts: readonly SemanticRoleReceipt[],
    bindings: readonly SemanticRoleBinding[],
): void {
    const receiptIndex = new Map<string, SemanticRoleReceipt>();
    for (const receipt of receipts) {
        if (receipt.method !== 'authored-cascade-offscreen-clone')
            throw new Error(`unsupported semantic role receipt method for ${receipt.containerSelector}`);
        const key = `${receipt.containerSelector}\0${receipt.role}`;
        if (receiptIndex.has(key)) throw new Error(`duplicate semantic role receipt ${receipt.containerSelector} ${receipt.role}`);
        receiptIndex.set(key, receipt);
    }
    const bindingIndex = new Map<string, SemanticRoleBinding>();
    for (const binding of bindings) {
        if (bindingIndex.has(binding.bindingSourceId))
            throw new Error(`duplicate semantic role binding ${binding.bindingSourceId}`);
        bindingIndex.set(binding.bindingSourceId, binding);
    }
    const matched = new Map(bindings.map((binding) => [binding.bindingSourceId, 0]));
    const visit = (node: NativeNode) => {
        const binding = node.name ? bindingIndex.get(node.name) : undefined;
        if (binding) {
            if (node.attributes?.pulpValueKind !== 'markdown')
                throw new Error(`semantic role binding target ${binding.bindingSourceId} is not Markdown`);
            const selected = receipts.filter((receipt) => receipt.containerSelector === binding.containerSelector);
            if (!selected.length) throw new Error(`no semantic role receipts for ${binding.containerSelector}`);
            node.attributes = { ...node.attributes };
            for (const receipt of selected) {
                const prefix = `pulpMarkdown${rolePrefix[receipt.role]}`;
                const style = receipt.computedStyle;
                if (style['font-family']) node.attributes[`${prefix}FontFamily`] = style['font-family'];
                if (style['font-size']) node.attributes[`${prefix}FontSize`] = style['font-size'];
                if (style['font-weight']) node.attributes[`${prefix}FontWeight`] = style['font-weight'];
                if (style.color) node.attributes[`${prefix}Color`] = style.color;
                if (receipt.role === 'inline-code') {
                    if (style['background-color']) node.attributes[`${prefix}Background`] = style['background-color'];
                    const uniform = (properties: readonly string[]) => {
                        const values = properties.map((property) => style[property]).filter((value) => value !== undefined && value !== '');
                        return values.length === properties.length && values.every((value) => value === values[0])
                            ? values[0] : undefined;
                    };
                    const borderColor = uniform(['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color']);
                    const borderWidth = uniform(['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width']);
                    const radius = uniform(['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']);
                    const paddingX = uniform(['padding-left', 'padding-right']);
                    const paddingY = uniform(['padding-top', 'padding-bottom']);
                    if (borderColor) node.attributes[`${prefix}BorderColor`] = borderColor;
                    if (borderWidth) node.attributes[`${prefix}BorderWidth`] = borderWidth;
                    if (radius) node.attributes[`${prefix}Radius`] = radius;
                    if (paddingX) node.attributes[`${prefix}PaddingX`] = paddingX;
                    if (paddingY) node.attributes[`${prefix}PaddingY`] = paddingY;
                }
            }
            matched.set(binding.bindingSourceId, (matched.get(binding.bindingSourceId) ?? 0) + 1);
        }
        for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    for (const binding of bindings) {
        const count = matched.get(binding.bindingSourceId) ?? 0;
        if (count !== 1) throw new Error(`semantic role binding ${binding.bindingSourceId} matched ${count} nodes; expected exactly one`);
    }
}

// Public surface for @pulp/import-ir.
//
// Exposes the typed IR, content-hash anchors, Claude Design HTML adapter,
// tweaks layer, diffing, and JSX-like tree map. The package stays
// renderer-agnostic so adapters (Figma MCP, Pencil, Mitosis, etc.) can
// share the same IR contract.

export * from './types.js';
export {
    hashCodeAsString,
    generateAnchorId,
    assignAnchors,
    DEFAULT_ANCHOR_STRATEGY,
} from './anchors.js';
export {
    applyTweaks,
    setByDottedPath,
    nodeFsTweaksIO,
    emptyTweaksFile,
    orphanedTweakDrifts,
    type TweaksIO,
} from './tweaks.js';
export { diff } from './diff.js';
export {
    toJSXLikeTree,
    flattenJSXLike,
    type JSXLikeNode,
} from './lower-via-prop-applier.js';
export {
    toNativeDesignIrV1,
    type NativeDesignIrV1,
    type NativeDesignIrMetadata,
} from './native-design-ir-v1.js';
export {
    lowerClaudeDesignHtml,
    ADAPTER_NAME as CLAUDE_DESIGN_HTML_ADAPTER_NAME,
    ADAPTER_VERSION as CLAUDE_DESIGN_HTML_ADAPTER_VERSION,
} from './adapters/claude-design-html/lower.js';
export {
    lowerObservedDom,
    OBSERVED_DOM_ADAPTER_NAME,
    OBSERVED_DOM_ADAPTER_VERSION,
    type ObservedDomNode,
} from './adapters/observed-dom/lower.js';

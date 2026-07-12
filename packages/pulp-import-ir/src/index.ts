// Public surface for @pulp/import-ir.
//
// Exposes the typed IR, content-hash anchors, Claude Design HTML adapter,
// tweaks layer, diffing, and JSX-like tree map. The package stays
// renderer-agnostic so adapters (Figma MCP, Pencil, Mitosis, etc.) can
// share the same IR contract.

export * from './types.js';
export { normalizeCssColor, type NormalizedCssColor } from './css-color.js';
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
    canonicalizeInlineSvg,
    projectInlineSvgCaptures,
    type CanonicalInlineSvg,
    type InlineSvgCapture,
    type InlineSvgDiagnostic,
    type InlineSvgProjection,
} from './inline-svg.js';
export {
    buildImportedFontInventory,
    collectObservedFontUses,
    macosSkiaPlatformFontContract,
    parseCssFontFamilies,
    type BundledFontSource,
    type ImportedFontDiagnostic,
    type ImportedFontInventory,
    type ObservedFontUse,
    type PlatformFontContract,
} from './imported-fonts.js';
export {
    extractTokenCandidates,
    serializeTokenCandidates,
    promoteTokenCandidates,
    rewritePromotedTokens,
    resolvePromotedTokens,
    assertRenderNeutral,
    reconcileTokenAdherence,
    type TokenCandidateKind,
    type TokenScenario,
    type TokenObservation,
    type TokenCandidate,
    type TokenMergeSuggestion,
    type TokenCandidateDocument,
    type TokenCandidateDiagnostic,
    type TokenPromotionDecision,
    type PromotedToken,
    type AuthoredTokenPromotionDocument,
} from './token-candidates.js';
export {
    lowerClaudeDesignHtml,
    ADAPTER_NAME as CLAUDE_DESIGN_HTML_ADAPTER_NAME,
    ADAPTER_VERSION as CLAUDE_DESIGN_HTML_ADAPTER_VERSION,
} from './adapters/claude-design-html/lower.js';
export {
    lowerObservedDom,
    lowerObservedDomWithLayoutReport,
    OBSERVED_DOM_ADAPTER_NAME,
    OBSERVED_DOM_ADAPTER_VERSION,
    type ObservedDomNode,
    type ObservedDomContent,
} from './adapters/observed-dom/lower.js';
export {
    classifyObservedDomLayout,
    loweredLayoutFor,
    resolveColumnFlexChildMargins,
    type DisplayCapability,
    type DisplayCapabilityEntry,
    type DisplayCapabilityReport,
    type GeometryOracleResult,
    type LayoutDiagnostic,
} from './adapters/observed-dom/layout-capability.js';

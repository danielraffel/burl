// Public surface for @pulp/import-ir.
//
// Exposes the typed IR, content-hash anchors, Claude Design HTML adapter,
// tweaks layer, diffing, and JSX-like tree map. The package stays
// renderer-agnostic so adapters (Figma MCP, Pencil, Mitosis, etc.) can
// share the same IR contract.

export * from './types.js';
export { captureCohortKey, type CaptureEvidence } from './capture-cohort.js';
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
    mergeNativeAssetManifests,
    type NativeAssetManifest,
    type NativeAssetManifestAsset,
} from './native-asset-manifest.js';
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
    projectAggregateRuntimeFontFaces,
    macosSkiaPlatformFontContract,
    parseCssFontFamilies,
    type BundledFontSource,
    type ImportedFontDiagnostic,
    type ImportedFontInventory,
    type ObservedFontUse,
    type RuntimeUsedFont,
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
    type ObservedDomLowerOptions,
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
export {
    reconcileResponsiveConstraints,
    applyResponsiveConstraints,
    unionResponsiveTrees,
    alignStableObservedDomIdentities,
    alignStableObservedDomIdentitiesWithReport,
    type ResponsiveCapture,
    type ResponsiveAxisKind,
    type ResponsiveAxisConstraint,
    type ResponsiveBreakpointInterval,
    type ResponsiveVisibilityVariant,
    type ResponsiveLayoutVariant,
    type TypedResponsiveConstraints,
    type ResponsiveDiagnostic,
    type ResponsiveReconciliation,
    type ResponsiveMatchReport,
} from './responsive-constraints.js';
export {
    extractInteractionCandidates,
    type ReviewedInteractionRule,
    type InteractionCandidate,
    type InteractionCandidateReport,
    type InteractionCandidateDiagnostic,
} from './interaction-candidates.js';
export {
    attachSemanticRoleReceipts,
    type SemanticMarkdownRole,
    type SemanticRoleBinding,
    type SemanticRoleReceipt,
} from './semantic-role-receipts.js';
export {
    unionApplicationStateTrees,
    type ApplicationStateCapture,
} from './application-state-variants.js';
export {
    composeApplicationStateDimensions,
    protectedApplicationStateStableIdentity,
    protectedApplicationStateSemanticIdentity,
    protectedApplicationStateLocalSemanticIdentity,
    pruneSemanticallyClosedTransientStatePortals,
    type ProtectedApplicationStateDimension,
    type ApplicationStateCompositionBudget,
    type ApplicationStateCompositionReport,
} from './compose-application-state-dimensions.js';
export {
    composeResponsiveApplicationStateLayers,
    type ResponsiveApplicationStateLayerDimension,
    type ResponsiveApplicationStateLayerReport,
} from './compose-responsive-application-state-layers.js';
export {
    attachApplicationStateActionTransitions,
    validateApplicationStatePolicyRules,
    type ApplicationStatePolicyRule,
    type ApplicationStateActionTransitionContract,
    type ApplicationStateActionAttachment,
} from './application-state-contract.js';
export {
    extractObservedOverlayContracts,
    applyObservedOverlayContracts,
    rebaseObservedOverlayContractContentIdentities,
    type ObservedOverlayKind,
    type ObservedOverlayActivationEvent,
    type ObservedOverlayDismissal,
    type ObservedOverlayActivation,
    type ObservedOverlayDismissalEvidence,
    type ObservedOverlayContract,
    type ObservedOverlayDiagnostic,
    type ObservedOverlayContractReport,
    type ObservedOverlayContractIdentityRebase,
} from './overlay-contract.js';
export {
    stableAuthoredSourceSuffix,
    resolveUniqueStableSourceId,
} from './stable-source-identity.js';
export {
    rebaseAuthoritativeVisualState,
    type NativeVisualStateNode,
    type AuthoritativeVisualStateRebaseReport,
    type AuthoritativeVisualStateRebaseResult,
} from './authoritative-visual-state.js';
export {
    applySourceBindingPolicy,
    type SourceBindingPolicy,
    type SourceBindingPolicyMatch,
    type SourceBindingPolicyRule,
    type SourceBindingPolicyReceipt,
    type SourceBindingPolicyCollision,
    type SourceBindingPolicyOptions,
    type SourceBindingPolicyActionAlias,
    resolveSourceBindingPolicyAction,
} from './source-binding-policy.js';
export {
    applyTrustedInteractionPayloadReceipts,
    type TrustedInteractionPayloadReceiptEvidence,
    type TrustedInteractionPayloadReceiptProjection,
    type TrustedInteractionPayloadReceiptReport,
} from './trusted-interaction-payload-receipts.js';
export {
    applyInvocationPayloadReceipts,
    captureInvocationPayloadReceipt,
    type InvocationPayloadFieldReceipt,
    type InvocationPayloadFieldSpec,
    type InvocationPayloadReceipt,
    type InvocationPayloadReceiptSpec,
    type InvocationPayloadProjectionReport,
    type InvocationPayloadValueType,
    type InvocationTraceEvidence,
    type InvocationTraceRecord,
} from './invocation-payload-receipts.js';
export {
    extractObservedDisclosureContracts,
    materializeObservedDisclosureState,
    type ObservedDisclosureActivation,
    type ObservedDisclosureClosureEvidence,
    type ObservedDisclosureContract,
    type ObservedDisclosureDiagnostic,
    type ObservedDisclosureContractReport,
} from './disclosure-contract.js';

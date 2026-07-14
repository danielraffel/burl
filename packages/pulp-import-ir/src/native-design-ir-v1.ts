import type { IRNode } from './types.js';
import { canonicalizeInlineSvg, projectInlineSvgCaptures, sha256, type InlineSvgCapture, type InlineSvgProjection } from './inline-svg.js';
import { buildImportedFontInventory, collectObservedFontUses, type BundledFontSource, type ObservedFontUse, type PlatformFontContract } from './imported-fonts.js';

export interface NativeDesignIrMetadata {
    sourceFile: string;
    importedAt: string;
    sourceRevision?: string;
    inlineSvgCaptures?: readonly InlineSvgCapture[];
    observedFontUses?: readonly ObservedFontUse[];
    bundledFonts?: readonly BundledFontSource[];
    platformFonts?: PlatformFontContract;
    unsupportedObservedImagePolicy?: 'reject' | 'defer';
}

export interface NativeDesignIrV1 {
    version: 1;
    source: 'jsx';
    sourceFile: string;
    capture_method: 'runtime_snapshot';
    settle_rounds: number;
    fallback_reason: string;
    source_adapter: 'observed-dom';
    source_version: '1.0.0';
    imported_at: string;
    root: Record<string, unknown>;
    tokens: { colors: Record<string, string>; dimensions: Record<string, number>; strings: Record<string, string> };
    assetManifest: { version: 1; assets: unknown[] };
    fontFamilyAssets: unknown[];
    diagnostics: unknown[];
}

export function toNativeDesignIrV1(root: IRNode, metadata: NativeDesignIrMetadata): NativeDesignIrV1 {
    const svg = projectInlineSvgCaptures(root, metadata.inlineSvgCaptures ?? collectInlineSvgCaptures(root));
    const fonts = buildImportedFontInventory(metadata.observedFontUses ?? collectObservedFontUses(root), metadata.bundledFonts ?? [], metadata.platformFonts);
    const images = projectObservedDataImages(root, metadata.unsupportedObservedImagePolicy ?? 'reject');
    const resolvedFontFamilies = new Map(fonts.resolutions
        .filter((resolution) => resolution.exact && resolution.resolvedFamilies?.length)
        .map((resolution) => [resolution.sourceId, resolution.resolvedFamilies!.map(cssFontFamily).join(', ')]));
    return {
        version: 1,
        source: 'jsx',
        sourceFile: metadata.sourceFile,
        capture_method: 'runtime_snapshot',
        settle_rounds: 2,
        fallback_reason: '',
        source_adapter: 'observed-dom',
        source_version: '1.0.0',
        imported_at: metadata.importedAt,
        root: nodeToNative(root, metadata.sourceRevision, svg, resolvedFontFamilies, images.bySourceId),
        tokens: { colors: {}, dimensions: {}, strings: {} },
        assetManifest: { version: 1, assets: [...svg.assets, ...images.assets, ...fonts.assets] },
        fontFamilyAssets: fonts.fontFamilyAssets,
        diagnostics: [...svg.diagnostics, ...fonts.diagnostics, ...images.diagnostics],
    };
}

export function collectInlineSvgCaptures(root: IRNode): InlineSvgCapture[] {
    const captures: InlineSvgCapture[] = [];
    const visit = (node: IRNode) => {
        if (node.raw_source.kind === 'observed-dom') {
            const observed = node.raw_source.node as { sourceId?: unknown; tagName?: unknown; inlineSvg?: unknown };
            if (observed.tagName === 'svg' && typeof observed.sourceId === 'string' &&
                typeof observed.inlineSvg === 'string' && observed.inlineSvg.trim()) {
                captures.push({
                    sourceId: observed.sourceId,
                    outerHTML: observed.inlineSvg,
                    ...(node.raw_source.computedStyle.color
                        ? { computedColor: node.raw_source.computedStyle.color } : {}),
                });
            }
        }
        node.children.forEach(visit);
    };
    visit(root);
    return captures.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

function nodeToNative(node: IRNode, sourceRevision: string | undefined, svg: InlineSvgProjection,
                      resolvedFontFamilies: ReadonlyMap<string, string>,
                      dataImages: ReadonlyMap<string, string>,
                      parentNode?: IRNode): Record<string, unknown> {
    const attributes: Record<string, string> = {};
    // Reviewed source-binding policy is applied after responsive/state union,
    // so its typed value/template metadata lives on the IR node rather than in
    // the original DOM snapshot. Preserve that contract through native
    // materialization; arbitrary observed HTML attributes remain excluded.
    const reviewedAttributes = (node as any).attributes as Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(reviewedAttributes ?? {})) {
        if (/^pulp(?:Value|Collection|BindingPolicy)/.test(key) && typeof value === 'string')
            attributes[key] = value;
    }
    if (node.meta?.role) attributes.role = node.meta.role;
    if (node.meta?.semantic_id) attributes.semantic_id = node.meta.semantic_id;
    if (node.meta?.accessibility_name) attributes.accessibility_name = node.meta.accessibility_name;
    if (typeof node.meta?.placeholder === 'string') attributes.placeholder = node.meta.placeholder;
    if (typeof node.meta?.accessibility_pressed === 'string') attributes.accessibility_pressed = node.meta.accessibility_pressed;
    if (typeof node.meta?.accessibility_checked === 'string') attributes.accessibility_checked = node.meta.accessibility_checked;
    if (typeof node.meta?.accessibility_expanded === 'string') attributes.accessibility_expanded = node.meta.accessibility_expanded;
    if (typeof node.meta?.accessibility_disabled === 'string') attributes.accessibility_disabled = node.meta.accessibility_disabled;
    if (typeof node.meta?.accessibility_hidden === 'string') attributes.accessibility_hidden = node.meta.accessibility_hidden;
    if (node.meta?.disabled === true) attributes.disabled = 'true';
    if (typeof node.meta?.focusable === 'boolean') attributes.focusable = String(node.meta.focusable);
    if (typeof node.meta?.tab_index === 'number') attributes.tabIndex = String(node.meta.tab_index);
    if (typeof node.meta?.source_data_slot === 'string') attributes.sourceDataSlot = node.meta.source_data_slot;
    if (node.raw_source.kind === 'observed-dom' && node.layout?.display === 'grid') {
        const sourceStyle = node.raw_source.computedStyle;
        const columns = sourceStyle.gridTemplateColumns && sourceStyle.gridTemplateColumns !== 'none'
            ? sourceStyle.gridTemplateColumns : inferObservedGridTracks(node, 'x');
        const rows = sourceStyle.gridTemplateRows && sourceStyle.gridTemplateRows !== 'none'
            ? sourceStyle.gridTemplateRows : inferObservedGridTracks(node, 'y');
        if (columns) attributes.pulpGridTemplateColumns = columns;
        if (rows) attributes.pulpGridTemplateRows = rows;
    }
    if (node.meta?.action_binding_id) attributes.action_binding_id = node.meta.action_binding_id;
    if (node.meta?.keyed_list_identity) attributes.keyed_list_identity = node.meta.keyed_list_identity;
    if (node.meta?.pointer_events === 'none') attributes.pulpHitTestable = 'false';
    const markdownRoleAttributes = node.meta?.markdown_role_attributes;
    if (markdownRoleAttributes && typeof markdownRoleAttributes === 'object' && !Array.isArray(markdownRoleAttributes)) {
        for (const [key, value] of Object.entries(markdownRoleAttributes as Record<string, unknown>)) {
            if (/^pulpMarkdown(?:Strong|InlineCode)[A-Za-z]+$/.test(key) && typeof value === 'string')
                attributes[key] = value;
        }
    }
    for (const [metadataKey, attributeKey] of [
        ['imported_overlay_kind', 'pulpOverlayKind'],
        ['imported_overlay_activation', 'pulpOverlayActivation'],
        ['imported_overlay_anchor', 'pulpOverlayAnchor'],
        ['imported_overlay_open_delay_ms', 'pulpOverlayOpenDelayMs'],
        ['imported_overlay_content_source_id', 'pulpOverlayContentSourceId'],
        ['imported_overlay_side', 'pulpOverlaySide'],
        ['imported_overlay_align', 'pulpOverlayAlign'],
        ['imported_overlay_dismiss_escape', 'pulpOverlayDismissEscape'],
        ['imported_overlay_dismiss_outside_pointer', 'pulpOverlayDismissOutsidePointer'],
        ['imported_overlay_dismiss_trigger_toggle', 'pulpOverlayDismissTriggerToggle'],
        ['imported_overlay_restore_focus', 'pulpOverlayRestoreFocus'],
        ['imported_overlay_content', 'pulpOverlayContent'],
        ['imported_overlay_trigger_source_id', 'pulpOverlayTriggerSourceId'],
        ['imported_overlay_host_for', 'pulpOverlayHostFor'],
        ['imported_state_key', 'pulpStateKey'],
        ['imported_state_transition', 'pulpStateTransition'],
        ['imported_disclosure_content_source_id', 'pulpDisclosureContentSourceId'],
    ] as const) {
        const value = node.meta?.[metadataKey];
        if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number')
            attributes[attributeKey] = String(value);
    }
    const dataImageAssetId = dataImages.get(node.source_node_id ?? node.stable_anchor_id);
    if (dataImageAssetId) attributes.srcAssetId = dataImageAssetId;
    const motion = node.meta?.observed_motion as Array<any> | undefined;
    if (motion?.length) {
        if (motion.length !== 1) throw new Error(`native motion import supports one animation per node, got ${motion.length}`);
        const receipt = motion[0];
        const rotations = receipt.keyframes.map((frame: any) => frame.transform)
            .filter((value: unknown): value is string => typeof value === 'string')
            .map((value: string) => value === 'none' ? 0 : Number(value.match(/^rotate\(\s*(-?(?:\d+|\d*\.\d+))deg\s*\)$/)?.[1]));
        const opacities = receipt.keyframes.map((frame: any) => frame.opacity)
            .filter((value: unknown) => value !== undefined).map((value: unknown) => Number(value));
        if (rotations.length && opacities.length)
            throw new Error(`native motion import does not combine transform and opacity on one node: ${node.source_node_id ?? node.stable_anchor_id}`);
        if (rotations.length && rotations.every((value: number) => Number.isFinite(value))) {
            attributes.motion_kind = 'rotation';
            attributes.motion_from = String(receipt.keyframes[0]?.offset === 0 && rotations.length > 1 ? rotations[0] : 0);
            attributes.motion_to = String(rotations.at(-1));
        } else if (opacities.length && opacities.every((value: number) => Number.isFinite(value) && value >= 0 && value <= 1)) {
            attributes.motion_kind = 'opacity';
            attributes.motion_from = String(opacities[0]);
            attributes.motion_to = String(opacities.at(-1));
        } else {
            throw new Error(`native motion import only supports rotate() or opacity keyframes for ${node.source_node_id ?? node.stable_anchor_id}`);
        }
        attributes.motion_duration_seconds = String(receipt.durationMs / 1000);
        attributes.motion_delay_seconds = String(receipt.delayMs / 1000);
        attributes.motion_iterations = String(receipt.iterations === 'infinite' ? -1 : receipt.iterations);
        attributes.motion_direction = receipt.direction;
        attributes.motion_easing = receipt.easing;
        attributes.motion_play_state = receipt.playState;
        attributes.motion_source_name = receipt.name;
    }
    if (node.interaction) {
        attributes.action_binding_id = node.interaction.actionBindingId;
        attributes.pulpRouteId = node.meta?.semantic_id ?? node.source_node_id ?? node.stable_anchor_id;
        attributes.pulpHostAction = node.interaction.actionBindingId;
        attributes.pulpEventContract = node.interaction.event;
        if (node.interaction.payloadContract) attributes.pulpPayloadContract = node.interaction.payloadContract;
        attributes.disabled = String(node.interaction.disabled);
        attributes.focusable = String(node.interaction.focusable);
        if (node.interaction.tabIndex !== undefined) attributes.tabIndex = String(node.interaction.tabIndex);
        if (node.interaction.selected !== undefined) attributes.selected = String(node.interaction.selected);
    }
    if (sourceRevision) attributes.source_revision = sourceRevision;
    const inlineSvg = node.source_node_id ? svg.documents.get(node.source_node_id) : undefined;
    const resolvedFontFamily = resolvedFontFamilies.get(node.source_node_id ?? node.stable_anchor_id);
    const visualSkin = nativeVisualSkin(node, resolvedFontFamily);
    return {
        type: nativeType(node.tag),
        name: node.meta?.semantic_id ?? node.source_node_id ?? node.tag,
        ...(node.text?.text ? { content: node.text.text } : {}),
        ...(node.textRuns && node.textRuns.length > 0 ? { textRuns: node.textRuns } : {}),
        layout: nativeLayout(node, parentNode?.layout),
        style: nativeStyle(node, resolvedFontFamily, parentNode),
        ...(visualSkin ? { visualSkin } : {}),
        ...(node.token_refs ? { token_refs: node.token_refs } : {}),
        ...(node.responsive ? { responsive: node.responsive } : {}),
        attributes,
        stable_anchor_id: node.stable_anchor_id,
        anchor_strategy: 'adapter',
        source_node_id: node.source_node_id ?? '',
        source_adapter: node.provenance.adapter,
        source_version: node.provenance.version,
        confidence: node.confidence.toLowerCase(),
        raw_source: JSON.stringify(node.raw_source),
        ...(inlineSvg ? { render_mode: 'faithful_svg', svg_asset_id: inlineSvg.assetId } : {}),
        ...(inlineSvg && node.interaction?.actionBindingId ? {
            interactiveElements: [{
                kind: 'action',
                x: 0, y: 0,
                w: typeof node.layout?.width === 'number' ? node.layout.width : 0,
                h: typeof node.layout?.height === 'number' ? node.layout.height : 0,
                action: node.interaction.actionBindingId,
                source_node_id: node.source_node_id ?? '',
            }],
        } : {}),
        children: node.children.map((child) =>
            nodeToNative(child, sourceRevision, svg, resolvedFontFamilies, dataImages, node)),
    };
}

// Some CDP/DOMSnapshot producers omit resolved grid-template tracks while still
// reporting exact child border boxes. Recover only the unambiguous case: each
// observed track start has one consistent size and all adjacent gaps agree.
// Spanning or irregular tracks fail closed and remain a visible import
// diagnostic rather than being guessed from product-specific geometry.
function inferObservedGridTracks(node: IRNode, axis: 'x' | 'y'): string | undefined {
    if (node.raw_source.kind !== 'observed-dom') return undefined;
    const parent = node.raw_source.node as { rect?: { x: number; y: number; width: number; height: number } };
    const position = axis === 'x' ? 'x' : 'y';
    const extent = axis === 'x' ? 'width' : 'height';
    const samples = node.children.flatMap((child) => {
        if (child.raw_source.kind !== 'observed-dom') return [];
        const style = child.raw_source.computedStyle;
        if (!['', 'static', 'relative'].includes((style.position ?? '').trim().toLowerCase())) return [];
        const observed = child.raw_source.node as { rect?: Record<string, number> };
        const rect = observed.rect;
        if (!rect || !(rect[extent] > 0)) return [];
        return [{ start: rect[position], size: rect[extent], child }];
    }).sort((a, b) => a.start - b.start);
    if (samples.length === 0 || !parent.rect) return undefined;

    const tolerance = 0.75;
    const groups: Array<{ start: number; sizes: number[]; children: IRNode[] }> = [];
    for (const sample of samples) {
        const group = groups.find((candidate) => Math.abs(candidate.start - sample.start) <= tolerance);
        if (group) {
            group.sizes.push(sample.size);
            group.children.push(sample.child);
        } else groups.push({ start: sample.start, sizes: [sample.size], children: [sample.child] });
    }
    const tracks = groups.map((group) => {
        const min = Math.min(...group.sizes);
        const max = Math.max(...group.sizes);
        return max - min <= tolerance ? group.sizes.reduce((sum, value) => sum + value, 0) / group.sizes.length : NaN;
    });
    if (tracks.some((track) => !Number.isFinite(track) || track <= 0)) return undefined;

    const gaps = groups.slice(1).map((group, index) => group.start - groups[index].start - tracks[index]);
    if (gaps.some((gap) => gap < -tolerance)) return undefined;
    if (gaps.length > 1 && Math.max(...gaps) - Math.min(...gaps) > tolerance) return undefined;
    const parentStart = parent.rect[position];
    const parentEnd = parentStart + parent.rect[extent];
    const lastEnd = groups.at(-1)!.start + tracks.at(-1)!;
    if (groups[0].start < parentStart - tolerance || lastEnd > parentEnd + tolerance) return undefined;
    if (axis === 'x' && groups.length === 2 && groups.every((group) => group.children.length >= 2)) {
        const alignments = groups.map((group) => new Set(group.children.map((child) =>
            child.raw_source.kind === 'observed-dom'
                ? (child.raw_source.computedStyle.textAlign ?? 'start').trim().toLowerCase()
                : '')));
        const leadingLabels = [...alignments[0]].every((alignment) =>
            ['', 'left', 'start'].includes(alignment));
        const trailingValues = [...alignments[1]].every((alignment) =>
            ['right', 'end'].includes(alignment));
        // A repeated leading-label/trailing-value grid is the observable used
        // geometry of CSS `auto 1fr`: the value column consumes the remaining
        // width and aligns its contents to the trailing edge. Preserve those
        // track semantics so a native font with slightly different metrics can
        // grow the label track instead of clipping text to browser-specific
        // pixel widths. Other grids retain exact observed tracks below.
        if (leadingLabels && trailingValues) return 'auto 1fr';
    }
    return tracks.map((track) => `${Number(track.toFixed(4))}px`).join(' ');
}

function projectObservedDataImages(root: IRNode, unsupportedPolicy: 'reject' | 'defer'): {
    bySourceId: Map<string, string>; assets: Record<string, unknown>[]; diagnostics: Record<string, unknown>[];
} {
    const bySourceId = new Map<string, string>();
    const byUri = new Map<string, Record<string, unknown>>();
    const diagnostics: Record<string, unknown>[] = [];
    const visit = (node: IRNode) => {
        const observedUri = node.meta?.observed_image_src;
        if (typeof observedUri === 'string') {
            let uri: string = observedUri;
            const match = uri.match(/^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/);
            if (!match) {
                const sourceId = node.source_node_id ?? node.stable_anchor_id;
                if (unsupportedPolicy === 'reject')
                    throw new Error(`observed image ${sourceId} requires a supported base64 PNG, JPEG, WebP, or SVG data URI`);
                diagnostics.push({
                    kind: 'unsupported_observed_image_deferred',
                    source_node_id: sourceId,
                    uri,
                    message: 'unsupported observed image deferred until minimal state-frontier composition',
                });
                node.children.forEach(visit);
                return;
            }
            let mime = match[1];
            let payload = match[2];
            if (payload.length % 4 !== 0 || /=/.test(payload.slice(0, -2)))
                throw new Error(`observed image ${node.source_node_id ?? node.stable_anchor_id} has malformed base64`);
            if (match[1] === 'image/svg+xml') {
                const sourceId = node.source_node_id ?? node.stable_anchor_id;
                const canonical = canonicalizeInlineSvg({
                    sourceId,
                    outerHTML: utf8FromBase64(payload),
                    ...(node.raw_source.kind === 'observed-dom' && node.raw_source.computedStyle.color
                        ? { computedColor: node.raw_source.computedStyle.color } : {}),
                }, node.stable_anchor_id);
                if ('diagnostic' in canonical)
                    throw new Error(`observed image ${sourceId} has unsafe or unsupported SVG: ${canonical.diagnostic.code}`);
                payload = base64FromUtf8(canonical.document);
                uri = `data:image/svg+xml;base64,${payload}`;
                mime = 'image/svg+xml';
            }
            const contentHash = sha256(uri);
            const assetId = `observed-image-${contentHash.slice(0, 16)}`;
            bySourceId.set(node.source_node_id ?? node.stable_anchor_id, assetId);
            byUri.set(uri, { asset_id: assetId, original_uri: uri, content_hash: contentHash, mime, diagnostics: [] });
        }
        node.children.forEach(visit);
    };
    visit(root);
    return {
        bySourceId,
        assets: [...byUri.values()].sort((a, b) => String(a.asset_id).localeCompare(String(b.asset_id))),
        diagnostics: diagnostics.sort((a, b) => String(a.source_node_id).localeCompare(String(b.source_node_id))),
    };
}

function utf8FromBase64(payload: string): string {
    const binary = atob(payload);
    return new TextDecoder('utf-8', { fatal: true })
        .decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function base64FromUtf8(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function nativeVisualSkin(node: IRNode, resolvedFontFamily?: string): Record<string, unknown> | undefined {
    const kind = nativeType(node.tag);
    if (!new Set(['button', 'toggle_button', 'text_editor', 'scroll_view', 'checkbox', 'combo_box']).has(kind))
        return undefined;
    const rest = nativeVisualState(node.paint, node.text, node.layout, resolvedFontFamily);
    const captured = node.meta?.observed_visual_states as Record<string, {
        paint?: IRNode['paint']; text?: IRNode['text']; layout?: IRNode['layout'];
    }> | undefined;
    const states: Record<string, unknown> = { rest };
    for (const [state, value] of Object.entries(captured ?? {})) {
        const canonical = state === 'active' && kind !== 'scroll_view' ? 'pressed'
            : state === 'focus-visible' ? 'focused' : state;
        if (states[canonical] === undefined || state === 'pressed' || state === 'focused')
            states[canonical] = nativeVisualState(value.paint, value.text, value.layout);
    }
    return { states, tokenRefs: {} };
}

function nativeVisualState(paint: IRNode['paint'], text: IRNode['text'], layout: IRNode['layout'],
                           resolvedFontFamily?: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const background = skinColor(paint?.backgroundColor);
    const foreground = skinColor(paint?.color);
    const border = skinColor(paint?.borderColor);
    if (background) out.background = background;
    if (foreground) out.foreground = foreground;
    if (border) out.border = border;
    if (typeof paint?.borderWidth === 'number') out.borderWidth = paint.borderWidth;
    const radiusPercent = (value: unknown): number | undefined => {
        if (typeof value !== 'string' || !/^-?(?:\d+|\d*\.\d+)%$/.test(value)) return undefined;
        const percent = Number(value.slice(0, -1));
        return Number.isFinite(percent) ? percent : undefined;
    };
    if (typeof paint?.borderRadius === 'number') {
        out.cornerRadius = paint.borderRadius;
    } else if (radiusPercent(paint?.borderRadius) !== undefined) {
        out.cornerRadiusPercent = radiusPercent(paint?.borderRadius);
    } else {
        // Computed style capture is allowed to expose the four longhands even
        // when the authored CSS used `border-radius`. Native controls have one
        // radius slot, so preserve the exact value whenever those longhands
        // describe a uniform radius. Asymmetric corners remain on the native
        // node's box style and continue to fail closed for promoted controls.
        const corners = [paint?.borderTopLeftRadius, paint?.borderTopRightRadius,
            paint?.borderBottomRightRadius, paint?.borderBottomLeftRadius];
        if (corners.every(value => value === corners[0])) {
            if (corners.every((value): value is number => typeof value === 'number'))
                out.cornerRadius = corners[0];
            else if (radiusPercent(corners[0]) !== undefined)
                out.cornerRadiusPercent = radiusPercent(corners[0]);
        }
    }
    if (typeof text?.fontSize === 'number') out.fontSize = text.fontSize;
    if (typeof text?.letterSpacing === 'number') out.letterSpacing = text.letterSpacing;
    if (typeof text?.lineHeight === 'number') out.lineHeight = text.lineHeight;
    if (resolvedFontFamily) out.fontFamily = resolvedFontFamily;
    else if (typeof text?.fontFamily === 'string') out.fontFamily = text.fontFamily;
    if (typeof text?.fontWeight === 'number') out.fontWeight = text.fontWeight;
    else if (text?.fontWeight === 'bold') out.fontWeight = 700;
    else if (text?.fontWeight === 'normal') out.fontWeight = 400;
    const align = text?.textAlign;
    if (align === 'left') out.textAlign = 0;
    else if (align === 'right') out.textAlign = 2;
    else if (align === 'center') out.textAlign = 1;
    if (layout?.paddingLeft === layout?.paddingRight && typeof layout?.paddingLeft === 'number')
        out.insetHorizontal = layout.paddingLeft;
    if (layout?.paddingTop === layout?.paddingBottom && typeof layout?.paddingTop === 'number')
        out.insetVertical = layout.paddingTop;
    return out;
}

function skinColor(value: unknown): { r: number; g: number; b: number; a: number } | undefined {
    if (typeof value !== 'string' || !/^#[0-9a-f]{8}$/i.test(value)) return undefined;
    return {
        r: Number.parseInt(value.slice(1, 3), 16),
        g: Number.parseInt(value.slice(3, 5), 16),
        b: Number.parseInt(value.slice(5, 7), 16),
        a: Number.parseInt(value.slice(7, 9), 16),
    };
}

function nativeType(tag: string): string {
    const lower = tag.toLowerCase();
    if (lower === 'texteditor') return 'text_editor';
    if (lower === 'togglebutton') return 'toggle_button';
    if (lower === 'scrollview') return 'scroll_view';
    if (lower === 'combobox') return 'combo_box';
    if (lower === 'label') return 'text';
    if (lower === 'image') return 'image';
    if (lower === 'icon') return 'view';
    return lower;
}

function nativeLayout(node: IRNode, parentLayout?: IRNode['layout']): Record<string, unknown> {
    const value = node.layout ?? {};
    const out: Record<string, unknown> = {};
    const fluidFlexItem = (value.flexGrow !== undefined && value.flexGrow > 0) ||
        (value.flexBasis !== undefined && value.flexBasis !== 'auto');
    const parentMainAxis = parentLayout?.flexDirection === 'column' ? 'height' : 'width';
    const responsiveWidth = node.responsive?.horizontal !== undefined;
    const responsiveHeight = node.responsive?.vertical !== undefined;
    const parentOwnsWidth = (fluidFlexItem && parentMainAxis === 'width') || responsiveWidth;
    const parentOwnsHeight = (fluidFlexItem && parentMainAxis === 'height') || responsiveHeight;
    if (value.display) out.display = value.display === 'inline-flex' ? 'flex' : value.display;
    if (value.flexDirection) out.direction = value.flexDirection;
    if (value.flexWrap) {
        out.wrap = value.flexWrap !== 'nowrap';
        if (value.flexWrap === 'wrap-reverse') out.wrapReverse = true;
    }
    if (value.flexGrow !== undefined) out.flexGrow = value.flexGrow;
    if (value.flexShrink !== undefined) out.flexShrink = value.flexShrink;
    if (value.flexBasis !== undefined) out.flexBasis = String(value.flexBasis);
    if (value.order !== undefined) out.order = value.order;
    if (value.alignItems) out.align = normalizeAlign(value.alignItems);
    if (value.alignSelf) out.alignSelf = normalizeAlign(value.alignSelf);
    if (value.alignContent) out.alignContent = normalizeAlign(value.alignContent);
    if (value.justifyContent) out.justify = normalizeAlign(value.justifyContent);
    for (const [key, mapped] of [
        ['gap', 'gap'], ['rowGap', 'rowGap'], ['columnGap', 'columnGap'],
        ['paddingTop', 'paddingTop'], ['paddingRight', 'paddingRight'],
        ['paddingBottom', 'paddingBottom'], ['paddingLeft', 'paddingLeft'],
        ['marginTop', 'marginTop'], ['marginRight', 'marginRight'],
        ['marginBottom', 'marginBottom'], ['marginLeft', 'marginLeft'],
    ] as const) {
        const item = value[key];
        if (typeof item === 'number' || typeof item === 'string') out[mapped] = item;
    }
    if (value.boxSizing) out.boxSizing = value.boxSizing;
    if (value.overflowX) out.overflowX = value.overflowX;
    if (value.overflowY) out.overflowY = value.overflowY;
    if (node.meta?.observed_viewport_fill === true) {
        out.widthMode = 'fill';
        out.heightMode = 'fill';
    } else if (typeof value.width === 'number' && !parentOwnsWidth) {
        out.widthMode = 'fixed';
        out.width = value.width;
    }
    if (node.meta?.observed_viewport_fill !== true &&
        typeof value.height === 'number' && !parentOwnsHeight) {
        out.heightMode = 'fixed';
        out.height = value.height;
    } else if (value.height === 'auto') {
        out.heightMode = 'hug';
    }
    return out;
}

function nativeStyle(node: IRNode, resolvedFontFamily?: string,
                     parentNode?: IRNode): Record<string, unknown> {
    const paint = node.paint ?? {};
    const text = node.text ?? {};
    const layout = node.layout ?? {};
    const out: Record<string, unknown> = {};
    for (const key of [
        'backgroundColor', 'color', 'borderColor', 'borderWidth', 'borderStyle',
        'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
        'borderBottomRightRadius', 'borderBottomLeftRadius', 'opacity', 'cursor',
        'transform', 'transformOrigin',
    ] as const) {
        const value = paint[key];
        if (value !== undefined && !Array.isArray(value) && typeof value !== 'object' &&
            !(key.toLowerCase().includes('radius') && typeof value === 'string' && value.endsWith('%')))
            out[key] = value;
    }
    if (paint.boxShadow) {
        out.boxShadow = paint.boxShadow.length === 0 ? 'none' : paint.boxShadow.map((shadow) =>
            `${shadow.inset ? 'inset ' : ''}${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.spread ?? 0}px ${shadow.color}`
        ).join(', ');
    }
    if (paint.backdropFilter) {
        out.backdropFilter = paint.backdropFilter.length === 0
            ? 'none'
            : paint.backdropFilter.map((filter) => filter.fn === 'blur'
                ? `blur(${filter.px}px)` : filter.fn).join(' ');
    }
    if (paint.filter) {
        out.filter = paint.filter.length === 0 ? 'none' : paint.filter.map((filter) => {
            if (filter.fn === 'blur') return `blur(${filter.px}px)`;
            if (filter.fn === 'hue-rotate') return `hue-rotate(${filter.deg}deg)`;
            if (filter.fn === 'drop-shadow') return `drop-shadow(${filter.offsetX}px ${filter.offsetY}px ${filter.blur}px ${filter.color})`;
            return `${filter.fn}(${filter.amount})`;
        }).join(' ');
    }
    if (paint.backgroundGradient) out.backgroundGradient = paint.backgroundGradient.css;
    if (paint.backgroundLayers) out.backgroundLayers = paint.backgroundLayers.map((layer) => layer.css);
    for (const key of [
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
        'letterSpacing', 'wordSpacing', 'textAlign', 'textTransform', 'whiteSpace', 'textOverflow',
        'overflowWrap', 'wordWrap', 'direction',
    ] as const) {
        const value = text[key];
        if (value !== undefined) out[key] = value;
    }
    if (resolvedFontFamily) out.fontFamily = resolvedFontFamily;
    if (text.numberOfLines !== undefined) out.numberOfLines = text.numberOfLines;
    if (layout.position) out.position = layout.position;
    for (const key of ['top', 'right', 'bottom', 'left', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) {
        const value = layout[key];
        const viewportOwnedMinimum = node.meta?.observed_viewport_fill === true &&
            (key === 'minWidth' || key === 'minHeight');
        if (!viewportOwnedMinimum && (typeof value === 'number' || typeof value === 'string'))
            out[key] = value;
    }
    if (layout.bottom === 'auto') out.bottomAuto = true;
    if (layout.position === 'absolute' && parentNode) {
        const childRect = observedRect(node);
        const parentRect = observedRect(parentNode);
        if (childRect && parentRect) {
            // getBoundingClientRect is post-transform geometry. Reusing that
            // position while also retaining a CSS translate applies the
            // translation twice, which is especially visible for zero-sized
            // portal hosts. Recover the pre-transform absolute offset for the
            // translation component; scale/rotation remain represented by the
            // preserved transform matrix.
            const translation = transformTranslation(paint.transform);
            out.left = childRect.x - parentRect.x - translation.x;
            out.top = childRect.y - parentRect.y - translation.y;
            delete out.right;
            delete out.bottom;
            delete out.bottomAuto;
        }
    }
    // Browser captures report used pixel dimensions after flex layout. Fluid
    // flex items must keep their basis/grow contract instead of projecting
    // those used dimensions as fixed native sizes on either axis. Fixed items
    // with `flex-basis:auto` still retain their authored dimensions.
    const fluidFlexItem = (layout.flexGrow !== undefined && layout.flexGrow > 0) ||
        (layout.flexBasis !== undefined && layout.flexBasis !== 'auto');
    const parentMainAxis = parentNode?.layout?.flexDirection === 'column' ? 'height' : 'width';
    const parentOwnsWidth = (fluidFlexItem && parentMainAxis === 'width') ||
        node.responsive?.horizontal !== undefined;
    const parentOwnsHeight = (fluidFlexItem && parentMainAxis === 'height') ||
        node.responsive?.vertical !== undefined;
    if (node.meta?.observed_viewport_fill !== true &&
        (typeof layout.width === 'number' || typeof layout.width === 'string') &&
        !parentOwnsWidth)
        out.width = layout.width;
    if (node.meta?.observed_viewport_fill !== true &&
        typeof layout.height === 'number' && !parentOwnsHeight)
        out.height = layout.height;
    return out;
}

function transformTranslation(value: unknown): { x: number; y: number } {
    if (typeof value !== 'string' || value === 'none') return { x: 0, y: 0 };
    const matrix = value.match(/^matrix\(\s*(-?(?:\d+|\d*\.\d+))\s*,\s*(-?(?:\d+|\d*\.\d+))\s*,\s*(-?(?:\d+|\d*\.\d+))\s*,\s*(-?(?:\d+|\d*\.\d+))\s*,\s*(-?(?:\d+|\d*\.\d+))\s*,\s*(-?(?:\d+|\d*\.\d+))\s*\)$/);
    if (matrix) return { x: Number(matrix[5]), y: Number(matrix[6]) };
    const translate = value.match(/^translate\(\s*(-?(?:\d+|\d*\.\d+))px(?:\s*,\s*(-?(?:\d+|\d*\.\d+))px)?\s*\)$/);
    if (translate) return { x: Number(translate[1]), y: Number(translate[2] ?? 0) };
    const translateX = value.match(/^translateX\(\s*(-?(?:\d+|\d*\.\d+))px\s*\)$/);
    if (translateX) return { x: Number(translateX[1]), y: 0 };
    const translateY = value.match(/^translateY\(\s*(-?(?:\d+|\d*\.\d+))px\s*\)$/);
    if (translateY) return { x: 0, y: Number(translateY[1]) };
    return { x: 0, y: 0 };
}

function observedRect(node: IRNode): { x: number; y: number; width: number; height: number } | undefined {
    if (node.raw_source.kind !== 'observed-dom') return undefined;
    const rect = (node.raw_source.node as { rect?: Partial<Record<'x' | 'y' | 'width' | 'height', unknown>> }).rect;
    if (!rect || !['x', 'y', 'width', 'height'].every(key => typeof rect[key as keyof typeof rect] === 'number'))
        return undefined;
    return rect as { x: number; y: number; width: number; height: number };
}

function cssFontFamily(family: string): string {
    return family;
}

function normalizeAlign(value: string): string {
    if (value === 'flex-start') return 'start';
    if (value === 'flex-end') return 'end';
    return value;
}

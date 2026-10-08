/**
 * How the workspace arranges its panels around the viewport.
 *
 * - wide: editor | viewport | inspector, each independently toggled.
 * - medium: viewport | one side panel that shows the inspector or the editor.
 * - narrow: viewport above that same panel, split vertically.
 */
export type LayoutMode = 'wide' | 'medium' | 'narrow';

/** Three columns need room for a readable editor beside a usable viewport. */
const WIDE_LAYOUT_MIN_WIDTH = 1280;
/** Below this a side column would leave the viewport too thin to orbit. */
const NARROW_LAYOUT_MAX_WIDTH = 760;

export function readLayoutMode(windowWidth: number, windowHeight: number): LayoutMode {
    if (windowWidth >= WIDE_LAYOUT_MIN_WIDTH) {
        return 'wide';
    }
    // Portrait tablets have height to spare and no width: stack like a phone.
    const portrait = windowHeight > windowWidth;
    return windowWidth <= NARROW_LAYOUT_MAX_WIDTH || portrait ? 'narrow' : 'medium';
}

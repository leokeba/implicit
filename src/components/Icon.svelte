<script lang="ts" module>
    /**
     * 24x24 stroke glyphs drawn in the Lucide idiom (round caps, 2px stroke)
     * so toolbar buttons stay icon-sized without pulling in an icon package.
     */
    const ICON_PATHS = {
        'reset-view': ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
        expand: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'],
        collapse: ['M4 14h6v6', 'M20 10h-6V4', 'M14 10l7-7', 'M3 21l7-7'],
        layers: ['M12 2 2 7l10 5 10-5-10-5Z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
        code: ['M16 18l6-6-6-6', 'M8 6l-6 6 6 6'],
        'panel-left': ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M9 3v18'],
        'panel-right': ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M15 3v18'],
        'panel-bottom': ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M3 15h18'],
        'file-plus': ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6', 'M12 18v-6', 'M9 15h6'],
        'folder-plus': ['M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z', 'M12 10v6', 'M9 13h6'],
        revert: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
        close: ['M18 6 6 18', 'M6 6l12 12'],
        help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3', 'M12 17h.01'],
        download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
        send: ['M22 2 15 22l-4-9-9-4Z', 'M22 2 11 13'],
    } satisfies Record<string, string[]>;

    export type IconName = keyof typeof ICON_PATHS;
</script>

<script lang="ts">
    const { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg
    class="icon"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
>
    {#each ICON_PATHS[name] as d}
        <path {d} />
    {/each}
</svg>

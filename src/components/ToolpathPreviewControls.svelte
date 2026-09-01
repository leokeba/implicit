<script lang="ts">
    import { buildLegendGradient, toCssColor } from '../core/toolpath-preview/color-ramps';
    import type { ToolpathChannelSummary } from '../core/toolpath-preview/types';
    import type { ToolpathPreviewView } from '../studio/types';

    export let view: ToolpathPreviewView | null = null;
    export let onSelectChannel: (key: string) => void;
    export let onLayerRange: (minLayer: number, maxLayer: number) => void;
    export let onToggleTravels: (visible: boolean) => void;
    export let onToggleAutoScale: (autoScale: boolean) => void;

    let collapsed = false;
    let layerFrom = 0;
    let layerTo = 0;
    let showTravels = true;
    let syncedSignature = '';

    $: lastLayer = Math.max(0, (view?.layerCount ?? 1) - 1);

    // A new slice resets the scrubber: layer indices from the previous
    // toolpath mean nothing against a different layer count.
    $: signature = view ? `${view.layerCount}:${view.segmentCount}` : '';
    $: if (signature !== syncedSignature) {
        syncedSignature = signature;
        layerFrom = 0;
        layerTo = lastLayer;
    }

    $: activeChannel = view?.channels.find((channel) => channel.key === view?.activeChannelKey) ?? null;
    $: isCategorical = activeChannel?.kind === 'categorical';
    $: gradient = activeChannel && !isCategorical ? buildLegendGradient(activeChannel) : '';
    // The legend labels the domain in use, not the channel's whole-toolpath
    // range: with auto-scaling on, those differ as soon as layers are hidden.
    $: domainMin = view?.domainMin ?? 0;
    $: domainMax = view?.domainMax ?? 1;
    $: midpoint = activeChannel?.neutral ?? (domainMin + domainMax) / 2;
    $: rangeIsFull = layerFrom === 0 && layerTo === lastLayer;

    function formatValue(channel: ToolpathChannelSummary, value: number): string {
        const text = value.toFixed(channel.decimals);
        return channel.unit ? `${text} ${channel.unit}` : text;
    }

    function selectChannel(event: Event): void {
        onSelectChannel((event.currentTarget as HTMLSelectElement).value);
    }

    function setLayerFrom(event: Event): void {
        const value = Number((event.currentTarget as HTMLInputElement).value);
        layerFrom = Math.min(value, layerTo);
        onLayerRange(layerFrom, layerTo);
    }

    function setLayerTo(event: Event): void {
        const value = Number((event.currentTarget as HTMLInputElement).value);
        layerTo = Math.max(value, layerFrom);
        onLayerRange(layerFrom, layerTo);
    }

    function showAllLayers(): void {
        layerFrom = 0;
        layerTo = lastLayer;
        onLayerRange(layerFrom, layerTo);
    }

    function toggleTravels(event: Event): void {
        showTravels = (event.currentTarget as HTMLInputElement).checked;
        onToggleTravels(showTravels);
    }

    function toggleAutoScale(event: Event): void {
        onToggleAutoScale((event.currentTarget as HTMLInputElement).checked);
    }
</script>

{#if view}
    <section class="toolpath-controls" aria-label="Toolpath preview controls">
        <button
            class="toolpath-controls-header"
            type="button"
            aria-expanded={!collapsed}
            on:click={() => (collapsed = !collapsed)}
        >
            <span class="toolpath-controls-title">Toolpath</span>
            <span class="toolpath-controls-meta">
                {view.segmentCount.toLocaleString()} segments · {view.layerCount.toLocaleString()} layers
            </span>
            <span class="toolpath-controls-chevron" aria-hidden="true">{collapsed ? '+' : '−'}</span>
        </button>

        {#if !collapsed}
            <div class="toolpath-controls-body">
                {#if view.error}
                    <p class="toolpath-controls-error">{view.error}</p>
                {:else}
                    <label class="toolpath-field">
                        <span class="toolpath-field-label">Colour by</span>
                        <select
                            class="toolpath-select"
                            value={view.activeChannelKey ?? ''}
                            on:change={selectChannel}
                        >
                            {#each view.channels as channel (channel.key)}
                                <option value={channel.key}>{channel.label}</option>
                            {/each}
                        </select>
                    </label>

                    {#if activeChannel}
                        {#if isCategorical}
                            <ul class="toolpath-legend-categories">
                                {#each activeChannel.categories ?? [] as category (category.label)}
                                    <li>
                                        <span
                                            class="toolpath-legend-swatch"
                                            style:background={toCssColor(category.color)}
                                        ></span>
                                        {category.label}
                                    </li>
                                {/each}
                            </ul>
                        {:else}
                            <div class="toolpath-legend">
                                <div class="toolpath-legend-bar" style:background={gradient}></div>
                                <div class="toolpath-legend-scale">
                                    <span>{formatValue(activeChannel, domainMin)}</span>
                                    <span>{formatValue(activeChannel, midpoint)}</span>
                                    <span>{formatValue(activeChannel, domainMax)}</span>
                                </div>
                            </div>
                        {/if}
                        {#if activeChannel.description}
                            <p class="toolpath-legend-note">{activeChannel.description}</p>
                        {/if}
                    {/if}

                    <div class="toolpath-field">
                        <span class="toolpath-field-label">
                            Layers {layerFrom}–{layerTo}
                            {#if !rangeIsFull}
                                <button class="toolpath-inline-reset" type="button" on:click={showAllLayers}>
                                    show all
                                </button>
                            {/if}
                        </span>
                        <input
                            class="toolpath-range"
                            type="range"
                            min="0"
                            max={lastLayer}
                            value={layerFrom}
                            aria-label="First visible layer"
                            on:input={setLayerFrom}
                        />
                        <input
                            class="toolpath-range"
                            type="range"
                            min="0"
                            max={lastLayer}
                            value={layerTo}
                            aria-label="Last visible layer"
                            on:input={setLayerTo}
                        />
                    </div>

                    {#if !isCategorical}
                        <label class="toolpath-check">
                            <input
                                type="checkbox"
                                checked={view.autoScaleDomain}
                                on:change={toggleAutoScale}
                            />
                            Scale ramp to visible layers
                        </label>
                    {/if}

                    {#if view.travelSegmentCount > 0}
                        <label class="toolpath-check">
                            <input type="checkbox" checked={showTravels} on:change={toggleTravels} />
                            Show travels ({view.travelSegmentCount.toLocaleString()})
                        </label>
                    {/if}
                {/if}
            </div>
        {/if}
    </section>
{/if}

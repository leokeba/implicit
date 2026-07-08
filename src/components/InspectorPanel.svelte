<script lang="ts">
    import InspectorSchemaTab from './inspector/InspectorSchemaTab.svelte';
    import {
        buildInspectorTabSchema,
        INSPECTOR_TABS,
        type ControlTabId,
        type InspectorSchemaHandlers,
        type InspectorSchemaState,
    } from '../ui/inspector-schema';

    export let activeTab: ControlTabId;
    export let state: InspectorSchemaState;
    export let handlers: InspectorSchemaHandlers;
    export let onSelectTab: (tabId: ControlTabId) => void | Promise<void>;

    $: activeSchema = buildInspectorTabSchema(activeTab, state);
</script>

<aside id="controls" aria-label="Inspector">
    <div class="controls-shell">
        <div class="controls-header">
            <h2>Inspector</h2>
            <p class="controls-note">Scene, render, and print settings for the active surface.</p>
        </div>

        <div class="tab-bar">
            {#each INSPECTOR_TABS as tab}
                <button
                    class:is-active={activeTab === tab.id}
                    class="tab-button"
                    type="button"
                    aria-pressed={activeTab === tab.id}
                    on:click={() => onSelectTab(tab.id)}
                >
                    {tab.label}
                </button>
            {/each}
        </div>

        <div class="tab-panels">
            <InspectorSchemaTab tab={activeSchema} {state} {handlers} />
        </div>
    </div>
</aside>
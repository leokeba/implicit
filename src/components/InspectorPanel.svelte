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

    function handleTabKeydown(event: KeyboardEvent): void {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(event.key)) {
            return;
        }
        event.preventDefault();

        const currentIndex = INSPECTOR_TABS.findIndex((tab) => tab.id === activeTab);
        let nextIndex = currentIndex;
        if (event.key === 'ArrowLeft') {
            nextIndex = (currentIndex - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length;
        } else if (event.key === 'ArrowRight') {
            nextIndex = (currentIndex + 1) % INSPECTOR_TABS.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else {
            nextIndex = INSPECTOR_TABS.length - 1;
        }

        const nextTab = INSPECTOR_TABS[nextIndex];
        void onSelectTab(nextTab.id);
        const tabBar = (event.currentTarget as HTMLElement);
        const buttons = tabBar.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        buttons[nextIndex]?.focus();
    }
</script>

<aside id="controls" aria-label="Inspector">
    <div class="controls-shell">
        <div class="controls-header">
            <h2>Inspector</h2>
            <p class="controls-note">Scene, render, and print settings for the active surface.</p>
        </div>

        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div class="tab-bar" role="tablist" aria-label="Inspector sections" on:keydown={handleTabKeydown}>
            {#each INSPECTOR_TABS as tab}
                <button
                    class:is-active={activeTab === tab.id}
                    class="tab-button"
                    type="button"
                    role="tab"
                    id={`inspector-tab-${tab.id}`}
                    aria-selected={activeTab === tab.id}
                    aria-controls="inspector-tabpanel"
                    tabindex={activeTab === tab.id ? 0 : -1}
                    on:click={() => onSelectTab(tab.id)}
                >
                    {tab.label}
                </button>
            {/each}
        </div>

        <div class="tab-panels" id="inspector-tabpanel" role="tabpanel" aria-labelledby={`inspector-tab-${activeTab}`}>
            <InspectorSchemaTab tab={activeSchema} {state} {handlers} />
        </div>
    </div>
</aside>
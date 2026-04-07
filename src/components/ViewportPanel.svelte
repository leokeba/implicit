<script lang="ts">
    import type { SceneOption } from '../core/shader-pipeline';
    import { VIEW_MODE_OPTIONS } from '../ui/inspector-schema';

    export let activeSceneLabel: string;
    export let activeViewModeLabel: string;
    export let sceneOptions: SceneOption[];
    export let sceneId: string;
    export let viewMode: number;
    export let printerLabel: string;
    export let materialLabel: string;
    export let overlayVisible: boolean;
    export let actionPending: boolean;
    export let commandStatus: string;
    export let inspectorCollapsed: boolean;
    export let onResetView: () => void;
    export let onToggleInspector: () => void | Promise<void>;
    export let onCommitScene: (sceneId: string) => void;
    export let onCommitViewMode: (viewMode: number) => void;
    export let onToggleOverlay: () => void;
    export let onGenerateVaseGcode: () => void | Promise<void>;
    export let onBenchmarkVaseGcode: () => void | Promise<void>;
</script>

<main class="workspace-main">
    <section class="viewport-stage" aria-label="Viewport workspace">
        <div class="viewport-toolbar">
            <div class="viewport-command-surface">
                <div class="viewport-toolbar-group viewport-toolbar-group-strong">
                    <span class="viewport-badge">Live Viewport</span>
                    <label class="viewport-field">
                        <span class="viewport-field-label">Scene</span>
                        <select class="viewport-select" value={sceneId} on:change={(event) => onCommitScene((event.currentTarget as HTMLSelectElement).value)}>
                            {#each sceneOptions as scene}
                                <option value={scene.id}>{scene.name}</option>
                            {/each}
                        </select>
                    </label>
                    <div class="viewport-segmented" aria-label="Viewport mode">
                        {#each VIEW_MODE_OPTIONS as option}
                            <button
                                class:is-active={String(viewMode) === option.value}
                                class="viewport-segmented-button"
                                type="button"
                                aria-pressed={String(viewMode) === option.value}
                                on:click={() => onCommitViewMode(Number(option.value))}
                            >
                                {option.label}
                            </button>
                        {/each}
                    </div>
                </div>
                <div class="viewport-toolbar-actions">
                    <button class:chrome-button-secondary={!overlayVisible} class="chrome-button chrome-button-ghost" type="button" aria-pressed={overlayVisible} on:click={onToggleOverlay}>
                        {overlayVisible ? 'Overlay On' : 'Overlay Off'}
                    </button>
                    <button class="chrome-button chrome-button-ghost" type="button" disabled={actionPending} on:click={onGenerateVaseGcode}>Generate</button>
                    <button class="chrome-button chrome-button-ghost" type="button" disabled={actionPending} on:click={onBenchmarkVaseGcode}>Benchmark</button>
                    <button class="chrome-button chrome-button-ghost" type="button" on:click={onResetView}>Reset</button>
                    <button class="chrome-button chrome-button-ghost" type="button" aria-expanded={!inspectorCollapsed} on:click={onToggleInspector}>
                        {inspectorCollapsed ? 'Show Panel' : 'Hide Panel'}
                    </button>
                </div>
            </div>
        </div>

        <div class="viewport-hud viewport-hud-bottom">
            <article class="viewport-hud-panel">
                <span class="viewport-hud-label">Scene</span>
                <strong>{activeSceneLabel}</strong>
            </article>
            <article class="viewport-hud-panel">
                <span class="viewport-hud-label">View</span>
                <strong>{activeViewModeLabel}</strong>
            </article>
            <article class="viewport-hud-panel">
                <span class="viewport-hud-label">Machine</span>
                <strong>{printerLabel}</strong>
            </article>
            <article class="viewport-hud-panel">
                <span class="viewport-hud-label">Material</span>
                <strong>{materialLabel}</strong>
            </article>
            <article class="viewport-hud-panel viewport-hud-panel-wide">
                <span class="viewport-hud-label">Command</span>
                <strong>{commandStatus}</strong>
            </article>
        </div>
        <section id="preview" aria-label="Surface preview"></section>
    </section>
</main>
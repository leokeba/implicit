<script lang="ts">
    import type { SceneOption } from '../../core/shader-pipeline';
    import { VIEW_MODE_OPTIONS } from '../../ui/inspector-config';

    export let sceneOptions: SceneOption[];
    export let sceneId: string;
    export let viewMode: number;
    export let onCommitViewMode: (viewMode: number) => void;
    export let onCommitScene: (sceneId: string) => void;
</script>

<section class="tab-panel">
    <section class="inspector-group">
        <h3>Scene Controls</h3>
        <p class="group-caption">Scene choice and surface visualization stay close to the viewport workflow.</p>
        <div class="field-grid">
            <div class="field-row">
                <label for="view-mode-select">View mode</label>
                <select id="view-mode-select" value={String(viewMode)} on:change={(event) => onCommitViewMode(Number((event.currentTarget as HTMLSelectElement).value))}>
                    {#each VIEW_MODE_OPTIONS as option}
                        <option value={option.value}>{option.label}</option>
                    {/each}
                </select>
            </div>
            <div class="field-row">
                <label for="scene-select">Scene preset</label>
                <select id="scene-select" value={sceneId} on:change={(event) => onCommitScene((event.currentTarget as HTMLSelectElement).value)}>
                    {#each sceneOptions as scene}
                        <option value={scene.id}>{scene.name}</option>
                    {/each}
                </select>
            </div>
        </div>
    </section>
</section>
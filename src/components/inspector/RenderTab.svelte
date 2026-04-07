<script lang="ts">
    import type { AnimationParams, RaymarchParams } from '../../core/renderer';
    import { ANIMATION_FIELDS, RAYMARCH_FIELDS } from '../../ui/inspector-config';

    export let raymarchParams: RaymarchParams;
    export let animationParams: AnimationParams;
    export let onUpdateRaymarchField: (key: keyof RaymarchParams, value: number) => void;
    export let onUpdateAnimationField: (key: keyof AnimationParams, value: number) => void;
</script>

<section class="tab-panel">
    <section class="inspector-group">
        <h3>Raymarch</h3>
        <p class="group-caption">Quality knobs that shape the viewport render cost and surface accuracy.</p>
        <div class="field-grid">
            {#each RAYMARCH_FIELDS as field}
                <div class="field-row">
                    <label for={field.id}>{field.label}</label>
                    <input
                        id={field.id}
                        type="number"
                        step={field.step}
                        min={field.min}
                        max={field.max}
                        value={raymarchParams[field.key as keyof RaymarchParams]}
                        on:change={(event) => onUpdateRaymarchField(field.key as keyof RaymarchParams, Number((event.currentTarget as HTMLInputElement).value))}
                    >
                </div>
            {/each}
        </div>
    </section>

    <section class="inspector-group">
        <h3>Animation</h3>
        <p class="group-caption">Redraw throttling and frame periodicity for animated scenes.</p>
        <div class="field-grid">
            {#each ANIMATION_FIELDS as field}
                <div class="field-row">
                    <label for={field.id}>{field.label}</label>
                    <input
                        id={field.id}
                        type="number"
                        step={field.step}
                        min={field.min}
                        max={field.max}
                        value={animationParams[field.key as keyof AnimationParams]}
                        on:change={(event) => onUpdateAnimationField(field.key as keyof AnimationParams, Number((event.currentTarget as HTMLInputElement).value))}
                    >
                </div>
            {/each}
        </div>
    </section>
</section>
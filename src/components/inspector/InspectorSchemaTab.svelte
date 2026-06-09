<script lang="ts">
    import SliceDebugView from './SliceDebugView.svelte';
    import {
        canResetField,
        commitFieldValue,
        isFieldDisabled,
        isFieldOverridden,
        readFieldOptions,
        readFieldValue,
        resetFieldOverride,
        triggerInspectorAction,
        type InspectorSchemaHandlers,
        type InspectorSchemaState,
        type InspectorTabSchema,
    } from '../../ui/inspector-schema';

    export let tab: InspectorTabSchema;
    export let state: InspectorSchemaState;
    export let handlers: InspectorSchemaHandlers;
</script>

<section class="tab-panel">
    {#if tab.summary.length > 0}
        <section class="inspector-summary" aria-label={`${tab.label} summary`}>
            {#each tab.summary as item}
                <article class="summary-chip">
                    <span class="summary-chip-label">{item.label}</span>
                    <strong class="summary-chip-value">{item.read(state)}</strong>
                </article>
            {/each}
        </section>
    {/if}

    {#each tab.sections as section}
        <section class="inspector-group">
            <h3>{section.title}</h3>
            <p class="group-caption">{section.caption}</p>
            <div class="field-grid">
                {#each section.fields as field}
                    {@const overridden = isFieldOverridden(field, state)}
                    <div class:field-row-textarea={field.kind === 'textarea'} class:field-row-overridden={overridden} class="field-row">
                        <label for={field.id}>
                            {field.label}
                            {#if overridden && canResetField(field)}
                                <button
                                    class="field-override-reset"
                                    type="button"
                                    title="Override active. Reset to scene-defined value."
                                    on:click={() => resetFieldOverride(field, handlers)}
                                >&#8634;</button>
                            {/if}
                        </label>

                        {#if field.kind === 'select'}
                            <select
                                id={field.id}
                                value={String(readFieldValue(field, state))}
                                disabled={isFieldDisabled(field, state)}
                                on:change={(event) => commitFieldValue(field, (event.currentTarget as HTMLSelectElement).value, handlers)}
                            >
                                {#each readFieldOptions(field, state) as option}
                                    <option value={option.value}>{option.label}</option>
                                {/each}
                            </select>
                        {:else if field.kind === 'text'}
                            <input
                                id={field.id}
                                type={field.inputType ?? 'text'}
                                placeholder={field.placeholder ?? ''}
                                value={String(readFieldValue(field, state))}
                                disabled={isFieldDisabled(field, state)}
                                on:change={(event) => commitFieldValue(field, (event.currentTarget as HTMLInputElement).value, handlers)}
                            >
                        {:else if field.kind === 'textarea'}
                            <textarea
                                id={field.id}
                                rows={field.rows}
                                value={String(readFieldValue(field, state))}
                                disabled={isFieldDisabled(field, state)}
                                on:change={(event) => commitFieldValue(field, (event.currentTarget as HTMLTextAreaElement).value, handlers)}
                            ></textarea>
                        {:else}
                            <input
                                id={field.id}
                                class:action-input={field.target === 'command'}
                                type="number"
                                step={field.step}
                                min={field.min}
                                max={field.max}
                                value={Number(readFieldValue(field, state))}
                                disabled={isFieldDisabled(field, state)}
                                on:change={(event) => commitFieldValue(field, (event.currentTarget as HTMLInputElement).value, handlers)}
                            >
                        {/if}
                    </div>
                {/each}
            </div>
        </section>
    {/each}

    {#if tab.note}
        <p class="group-caption">{tab.note}</p>
    {/if}

    {#if tab.actions}
        <div class="action-row">
            {#each tab.actions as action}
                <button
                    class:action-button-secondary={action.tone === 'secondary'}
                    class="action-button"
                    type="button"
                    disabled={Boolean(action.disabledWhenPending && state.actionPending)}
                    on:click={() => triggerInspectorAction(action, handlers)}
                >
                    {action.label}
                </button>
            {/each}
        </div>
    {/if}

    {#if tab.consoleSource === 'outputStatus'}
        <div class="output-console">{state.outputStatus}</div>
        {#if state.sliceDebugSnapshot}
            <SliceDebugView snapshot={state.sliceDebugSnapshot} />
        {/if}
    {/if}
</section>
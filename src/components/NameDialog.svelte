<script lang="ts">
    import { onMount } from 'svelte';

    export let title: string;
    export let label: string;
    export let initial: string;
    export let hint: string = '';
    export let confirmLabel: string = 'Create';
    export let onSubmit: (value: string) => void;
    export let onCancel: () => void;

    let dialogElement: HTMLDialogElement;
    let inputElement: HTMLInputElement;
    let value = initial;

    onMount(() => {
        dialogElement.showModal();
        inputElement.select();
    });

    function handleClose(): void {
        // Fires for Escape and any close; treat as cancel unless submit already ran.
        onCancel();
    }

    function handleSubmit(event: SubmitEvent): void {
        event.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) {
            return;
        }
        dialogElement.removeEventListener('close', handleClose);
        dialogElement.close();
        onSubmit(trimmed);
    }
</script>

<dialog class="name-dialog" bind:this={dialogElement} on:close={handleClose}>
    <form on:submit={handleSubmit}>
        <h2>{title}</h2>
        <label class="name-dialog-field">
            <span>{label}</span>
            <input type="text" bind:this={inputElement} bind:value name="name" autocomplete="off" spellcheck="false">
        </label>
        {#if hint}
            <p class="name-dialog-hint">{hint}</p>
        {/if}
        <div class="name-dialog-actions">
            <button class="chrome-button chrome-button-ghost" type="button" on:click={() => dialogElement.close()}>Cancel</button>
            <button class="chrome-button" type="submit" disabled={!value.trim()}>{confirmLabel}</button>
        </div>
    </form>
</dialog>

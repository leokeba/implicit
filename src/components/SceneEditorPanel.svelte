<script lang="ts">
    import { cpp } from '@codemirror/lang-cpp';
    import { oneDark } from '@codemirror/theme-one-dark';
    import CodeMirror from 'svelte-codemirror-editor';

    import type { SceneDocument } from '../core/shader-pipeline';
    import type { SceneDocumentStorageMode } from '../ui/scene-documents';

    export let sceneDocument: SceneDocument | null;
    export let storageMode: SceneDocumentStorageMode;
    export let dirty: boolean;
    export let savePending: boolean;
    export let statusText: string;
    export let onChangeSource: (value: string) => void;
    export let onCreateScene: () => void | Promise<void>;
    export let onSaveScene: () => void | Promise<void>;
    export let onRevertScene: () => void;
    export let onClose: () => void;
    export let onStartResize: (event: PointerEvent) => void;

    const editorThemeStyles = {
        '&': {
            height: '100%',
            width: '100%',
            fontSize: '13px',
        },
        '.cm-scroller': {
            fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
        },
    };

    $: storageLabel = storageMode === 'filesystem' ? 'Folder Sync' : 'Browser Drafts';
    $: helperText = storageMode === 'filesystem'
        ? 'Saving writes directly into src/shaders/scenes so VS Code and the viewport stay in sync.'
        : 'Saving keeps bundled scene defaults and stores overrides or new scenes in browser storage.';
</script>

<section class="scene-editor-shell" aria-label="Scene editor">
    <button class="scene-editor-resizer" type="button" aria-label="Resize scene editor" on:pointerdown={onStartResize}></button>

    <header class="scene-editor-header">
        <div class="scene-editor-title-block">
            <div class="scene-editor-title-row">
                <span class="viewport-badge">Scene Editor</span>
                <span class="viewport-badge viewport-badge-muted">{storageLabel}</span>
                {#if dirty}
                    <span class="viewport-badge scene-editor-dirty-badge">Unsaved</span>
                {/if}
            </div>
            <h2>{sceneDocument?.name ?? 'No active scene'}</h2>
            <p class="scene-editor-caption">
                <strong>{sceneDocument?.fileName ?? 'No file selected'}</strong>
                {helperText}
            </p>
        </div>

        <div class="scene-editor-actions">
            <button class="chrome-button chrome-button-ghost" type="button" on:click={onCreateScene}>New Scene</button>
            <button class="chrome-button chrome-button-ghost" type="button" disabled={!dirty || savePending || !sceneDocument} on:click={onRevertScene}>Revert</button>
            <button class="chrome-button" type="button" disabled={!dirty || savePending || !sceneDocument} on:click={onSaveScene}>
                {savePending ? 'Saving...' : 'Save Scene'}
            </button>
            <button class="chrome-button chrome-button-ghost" type="button" on:click={onClose}>Hide Editor</button>
        </div>
    </header>

    <div class="scene-editor-statusbar">
        <span class="scene-editor-status-label">Editor Status</span>
        <p>{statusText}</p>
    </div>

    {#if sceneDocument}
        <div class="scene-editor-body">
            <CodeMirror
                class="scene-editor-codemirror"
                value={sceneDocument.source}
                lang={cpp()}
                theme={oneDark}
                lineWrapping={false}
                tabSize={4}
                styles={editorThemeStyles}
                onchange={onChangeSource}
            />
        </div>
    {/if}
</section>
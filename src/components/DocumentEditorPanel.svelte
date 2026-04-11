<script lang="ts">
    import { onDestroy, onMount } from 'svelte';

    import { cpp } from '@codemirror/lang-cpp';
    import { javascript } from '@codemirror/lang-javascript';
    import { oneDark } from '@codemirror/theme-one-dark';
    import { EditorView } from '@codemirror/view';
    import CodeMirror from 'svelte-codemirror-editor';

    export let panelLabel: string;
    export let storageLabel: string;
    export let dirty: boolean;
    export let dirtyLabel = 'Unsaved';
    export let savePending: boolean;
    export let statusText: string;
    export let documentName: string | null;
    export let documentFileName: string | null;
    export let source: string | null;
    export let helperText: string;
    export let createLabel: string;
    export let saveLabel: string;
    export let hideLabel: string;
    export let switchLabel: string;
    export let language: 'glsl' | 'javascript' | 'typescript';
    export let onChangeSource: (value: string) => void;
    export let onCreate: () => void | Promise<void>;
    export let onSave: () => void | Promise<void>;
    export let onRevert: () => void;
    export let onSwitchDocument: () => void | Promise<void>;
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

    const lightEditorTheme = EditorView.theme(
        {
            '&': {
                backgroundColor: '#f8fbff',
                color: '#102238',
            },
            '.cm-gutters': {
                backgroundColor: '#eef3f9',
                color: '#4b5b70',
                borderRight: '1px solid #c4d2e0',
            },
            '.cm-activeLine': {
                backgroundColor: 'rgba(0, 92, 200, 0.08)',
            },
            '.cm-activeLineGutter': {
                backgroundColor: 'rgba(0, 92, 200, 0.12)',
            },
            '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
                backgroundColor: 'rgba(0, 92, 200, 0.18)',
            },
            '&.cm-focused': {
                outline: 'none',
            },
            '.cm-cursor, .cm-dropCursor': {
                borderLeftColor: '#005cc8',
            },
        },
        { dark: false }
    );

    let editorTheme = oneDark;
    let themeMediaQuery: MediaQueryList | null = null;
    let handleThemeChange: ((event: MediaQueryListEvent) => void) | null = null;

    function syncEditorTheme(matchesDark: boolean): void {
        editorTheme = matchesDark ? oneDark : lightEditorTheme;
    }

    onMount(() => {
        if (typeof window === 'undefined') {
            return;
        }

        themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        syncEditorTheme(themeMediaQuery.matches);

        handleThemeChange = (event: MediaQueryListEvent) => {
            syncEditorTheme(event.matches);
        };

        if (typeof themeMediaQuery.addEventListener === 'function') {
            themeMediaQuery.addEventListener('change', handleThemeChange);
            return;
        }

        themeMediaQuery.addListener(handleThemeChange);
    });

    onDestroy(() => {
        if (!themeMediaQuery || !handleThemeChange) {
            return;
        }

        if (typeof themeMediaQuery.removeEventListener === 'function') {
            themeMediaQuery.removeEventListener('change', handleThemeChange);
            return;
        }

        themeMediaQuery.removeListener(handleThemeChange);
    });

    $: languageExtension = language === 'glsl'
        ? cpp()
        : javascript({ typescript: language === 'typescript' });
</script>

<section class="scene-editor-shell" aria-label={panelLabel}>
    <button class="scene-editor-resizer" type="button" aria-label={`Resize ${panelLabel.toLowerCase()}`} on:pointerdown={onStartResize}></button>

    <header class="scene-editor-header">
        <div class="scene-editor-title-block">
            <div class="scene-editor-title-row">
                <span class="viewport-badge">{panelLabel}</span>
                <span class="viewport-badge viewport-badge-muted">{storageLabel}</span>
                {#if dirty}
                    <span class="viewport-badge scene-editor-dirty-badge">{dirtyLabel}</span>
                {/if}
            </div>
            <h2>{documentName ?? `No active ${panelLabel.toLowerCase()}`}</h2>
            <p class="scene-editor-caption">
                <strong>{documentFileName ?? 'No file selected'}</strong>
                {helperText}
            </p>
        </div>

        <div class="scene-editor-actions">
            <button class="chrome-button chrome-button-ghost" type="button" on:click={onCreate}>{createLabel}</button>
            <button class="chrome-button chrome-button-ghost" type="button" on:click={onSwitchDocument}>{switchLabel}</button>
            <button class="chrome-button chrome-button-ghost" type="button" disabled={!dirty || savePending || !source} on:click={onRevert}>Revert</button>
            <button class="chrome-button" type="button" disabled={!dirty || savePending || !source} on:click={onSave}>
                {savePending ? 'Saving...' : saveLabel}
            </button>
            <button class="chrome-button chrome-button-ghost" type="button" on:click={onClose}>{hideLabel}</button>
        </div>
    </header>

    <div class="scene-editor-statusbar">
        <span class="scene-editor-status-label">Editor Status</span>
        <p>{statusText}</p>
    </div>

    {#if source !== null}
        <div class="scene-editor-body">
            <CodeMirror
                class="scene-editor-codemirror"
                value={source}
                lang={languageExtension}
                theme={editorTheme}
                lineWrapping={false}
                tabSize={4}
                styles={editorThemeStyles}
                onchange={onChangeSource}
            />
        </div>
    {/if}
</section>
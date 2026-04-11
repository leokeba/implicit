import '../styles.css';

import App from './App.svelte';
import { StudioController } from './studio-controller';
import { mount } from 'svelte';

const target = document.getElementById('app');

if (!target) {
    throw new Error('Application root was not found.');
}

mount(App, {
    target,
    props: {
        studio: new StudioController(),
    },
});

if (import.meta.hot) {
    let reloadScheduled = false;

    import.meta.hot.on('vite:beforeUpdate', (payload: unknown) => {
        if (reloadScheduled || typeof window === 'undefined') {
            return;
        }

        const updates = (payload as { updates?: Array<{ path?: unknown }> } | undefined)?.updates;
        const sourceUpdateDetected = Array.isArray(updates)
            && updates.some((update) => {
                const path = typeof update?.path === 'string' ? update.path : '';
                return path.includes('/src/') || path.endsWith('/styles.css');
            });

        if (!sourceUpdateDetected) {
            return;
        }

        reloadScheduled = true;
        window.location.reload();
    });
}

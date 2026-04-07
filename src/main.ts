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

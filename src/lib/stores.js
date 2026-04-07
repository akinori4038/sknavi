import { writable } from 'svelte/store';

export const mapCenter = writable({
    lat: null,
    lon: null
});

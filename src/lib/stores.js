// src/lib/stores.js
import { writable } from 'svelte/store';

export const lastLatStore = writable(null);
export const lastLngStore = writable(null);
export const headingStore = writable(0);
export const isTrackingStore = writable(true);
export const isPathOnStore = writable(false);
export const wpInfoStore = writable('');
export const trackStore = writable([]);
export const isHeadingUpStore = writable(false);
export const waypointStore = writable(null);
export const wpLineAddedStore = writable(false);
export const mapState = writable({
  center: [139.767125, 35.681236],
  zoom: 14,
  bearing: 0,
  pitch: 0
});
export const totalDistanceStore = writable(0);
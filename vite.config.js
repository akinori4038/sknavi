import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import fs from 'fs';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		https: {
			key: fs.readFileSync('localhost+1-key.pem'),
			cert: fs.readFileSync('localhost+1.pem')
		},
		host: true
	}
});
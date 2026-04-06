import adapter from '@sveltejs/adapter-static';
import { relative, sep } from 'node:path';

const dev = process.argv.includes('dev');

// ★ GitHub Pages のリポジトリ名
const repoName = 'sknavi';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => {
			const relativePath = relative(import.meta.dirname, filename);
			const pathSegments = relativePath.toLowerCase().split(sep);
			const isExternalLibrary = pathSegments.includes('node_modules');
			return isExternalLibrary ? undefined : true;
		}
	},
	kit: {
		adapter: adapter(),
		paths: {
			base: dev ? '' : `/${repoName}`
		},
		prerender: {
			handleHttpError: 'ignore'
		}
	}
};

export default config;
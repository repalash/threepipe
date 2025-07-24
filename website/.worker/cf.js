/**
 * This is a simple Cloudflare Worker proxy that serves specific packages from GitHub releases with CORS support.
 *
 * Deployed to https://pkg.threepipe.org/
 * Used in package.json
 */


const packages = {
    ['three']: 'https://github.com/repalash/three.js-modded/releases/download/',
    ['@types/three']: 'https://github.com/repalash/three-ts-types/releases/download/',
    ['tweakpane-image-plugin']: 'https://github.com/repalash/tweakpane-image-plugin/releases/download/',
};

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Handle CORS preflight requests
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Max-Age': '86400',
                    'Vary': 'Origin'
                }
            });
        }

        // Extract package name and remaining path using regex
        // Handles both regular packages and scoped packages like @types/three
        const depMatch = url.pathname.match(/^\/dep\/(.+?)\/-\/(.+)$/);

        if (!depMatch) {
            return new Response('Not Found', {
                status: 404,
                headers: { 'Content-Type': 'text/plain' }
            });
        }

        const packageName = depMatch[1];
        const remainingPath = depMatch[2];

        // Check if package exists in our mapping
        if (!packages[packageName]) {
            return new Response(`Package not found: ${packageName}`, {
                status: 404,
                headers: { 'Content-Type': 'text/plain' }
            });
        }

        const githubUrl = `${packages[packageName]}${remainingPath}`;

        try {
            const response = await fetch(githubUrl);

            if (!response.ok) {
                return new Response(`Package not found: ${packageName}/${remainingPath}`, {
                    status: 404,
                    headers: { 'Content-Type': 'text/plain' }
                });
            }

            return new Response(response.body, {
                status: response.status,
                headers: {
                    'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
                    'Cache-Control': response.headers.get('Cache-Control') || 'public, max-age=3600',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Vary': 'Origin'
                }
            });

        } catch (error) {
            return new Response(`Error: ${error.message}`, {
                status: 500,
                headers: { 'Content-Type': 'text/plain' }
            });
        }
    }
};

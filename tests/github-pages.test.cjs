const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const scope = 'https://prof-davidaffo.github.io/Snap/';

function worker() {
    const handlers = {}, deleted = [], matched = [];
    let claimed = false;
    const context = {
        URL, Response, console: {log() {}},
        self: {
            location: new URL('sw.js', scope),
            registration: {scope},
            addEventListener(name, callback) { handlers[name] = callback; },
            clients: {async claim() { claimed = true; }}
        },
        caches: {
            async keys() {
                return [
                    'snap-pwa:' + scope + ':old-version',
                    'snap-pwa:https://prof-davidaffo.github.io/Other/:old-version',
                    'snap-pwa-12.3.6',
                    'unrelated-site-cache',
                    context.cacheName
                ];
            },
            async delete(name) { deleted.push(name); },
            async open() {
                return {async match(request) {
                    const url = typeof request === 'string' ? request : request.url;
                    matched.push(url);
                    return url === scope + 'index.html' ?
                        new Response('<html>redirect</html>') : undefined;
                }};
            }
        },
        async fetch() { throw new Error('Offline'); }
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return {context, handlers, deleted, matched, get claimed() { return claimed; }};
}

test('cache activation deletes only obsolete caches belonging to this app path', async () => {
    const f = worker();
    let activation;
    f.handlers.activate({waitUntil(promise) { activation = promise; }});
    await activation;
    assert.deepEqual(f.deleted, ['snap-pwa:' + scope + ':old-version']);
    assert.equal(f.claimed, true);
});

test('Google API calls, other sites, and non-GET requests bypass the worker', () => {
    const f = worker();
    for (const [url, method] of [
        ['https://www.googleapis.com/drive/v3/files', 'GET'],
        ['https://accounts.google.com/gsi/client', 'GET'],
        ['https://prof-davidaffo.github.io/', 'GET'],
        ['https://prof-davidaffo.github.io/Snap-other/snap.html', 'GET'],
        [scope + 'anything', 'POST']
    ]) {
        f.handlers.fetch({request: {url, method},
            respondWith() { assert.fail('Worker intercepted ' + url); }});
    }
});

test('offline navigation to the project root serves its cached entry page', async () => {
    const f = worker();
    let response;
    f.handlers.fetch({request: {url: scope, method: 'GET'},
        respondWith(promise) { response = promise; }});
    assert.equal(await (await response).text(), '<html>redirect</html>');
    assert.deepEqual(f.matched, [scope + 'index.html']);
});

test('uncached offline resources return a network error response', async () => {
    const f = worker();
    let response;
    f.handlers.fetch({request: {url: scope + 'missing.txt', method: 'GET'},
        respondWith(promise) { response = promise; }});
    assert.equal((await response).type, 'error');
});

test('entry redirect preserves query and fragment under the repository path', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    let redirected;
    vm.runInNewContext(script, {window: {location: {
        search: '?lang=it', hash: '#open:project.xml',
        replace(target) { redirected = new URL(target, scope).href; }
    }}});
    assert.equal(redirected, scope + 'snap.html?lang=it#open:project.xml');
});

test('all startup and offline assets exist beneath the published root', () => {
    const f = worker();
    const html = fs.readFileSync(path.join(root, 'snap.html'), 'utf8');
    const scripts = [...html.matchAll(/<script src="([^"?]+)/g)]
        .map(match => match[1]).filter(name => !name.startsWith('https:'));
    for (const name of [...scripts, ...f.context.filesToCache]) {
        const url = new URL(name, scope);
        assert.ok(url.href.startsWith(scope), name + ' escapes the app path');
        assert.ok(fs.existsSync(path.join(root, name)), name + ' is missing');
    }
    assert.ok(fs.existsSync(path.join(root, '.nojekyll')));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    assert.equal(new URL(manifest.scope, scope).href, scope);
    assert.equal(new URL(manifest.start_url, scope).href, scope + 'snap.html');
});

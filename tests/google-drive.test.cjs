const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/google-drive.js'), 'utf8');
function fixture() {
    const requests = [];
    let oauth, popup, revoked, sdkError;
    const context = {
        URL, URLSearchParams, Blob, Promise, Date,
        location: {protocol: 'https:'}, isSecureContext: true,
        fetch: async (url, options) => {
            requests.push({url: String(url), ...options});
            return new Response(JSON.stringify({user: {
                permissionId: 'account-a', emailAddress: 'user@example.com'
            }}));
        },
        google: {accounts: {oauth2: {
            initTokenClient(options) {
                if (sdkError) { throw new Error('SDK failed'); }
                oauth = options;
                return {requestAccessToken(options) { popup = options; }};
            },
            hasGrantedAllScopes: () => true,
            revoke(token) { revoked = token; }
        }}}
    };
    context.window = context;
    Object.defineProperty(context, 'localStorage', {
        get() { throw new Error('Tokens must not be persisted'); }
    });
    vm.createContext(context);
    vm.runInContext(source, context);
    const drive = new context.GoogleDriveStorage('public-client-id');
    return {
        drive, context, requests,
        get popup() { return popup; },
        get oauth() { return oauth; },
        get revoked() { return revoked; },
        sdkError() { sdkError = true; },
        async login() {
            const pending = drive.connect();
            assert.ok(popup, 'popup opens before yielding the click handler');
            await oauth.callback({access_token: 'test-token', expires_in: 3600});
            await pending;
        },
        authorized() {
            drive.token = 'test-token';
            drive.expiresAt = Date.now() + 3600000;
            drive.user = {permissionId: 'account-a'};
        }
    };
}

test('missing client ID fails without opening Google', async () => {
    const f = fixture();
    f.drive.clientId = '';
    await assert.rejects(f.drive.connect(), /non è ancora attivato/);
    assert.equal(f.popup, undefined);
});

test('file URLs and insecure origins are rejected', async () => {
    const f = fixture();
    f.context.location.protocol = 'file:';
    await assert.rejects(f.drive.connect(), /HTTPS/);
    f.context.location.protocol = 'http:';
    f.context.isSecureContext = false;
    await assert.rejects(f.drive.connect(), /HTTPS/);
});

test('missing SDK reports an actionable error', async () => {
    const f = fixture();
    delete f.context.google;
    await assert.rejects(f.drive.connect(), /ricarica/);
    assert.equal(f.drive.pending, false);
});

test('connect opens popup synchronously and keeps credentials in memory', async () => {
    const f = fixture();
    await f.login();
    assert.equal(f.drive.connected, true);
    assert.equal(f.drive.user.permissionId, 'account-a');
    assert.equal(f.oauth.scope, 'https://www.googleapis.com/auth/drive.file');
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].headers.Authorization, 'Bearer test-token');
    assert.equal(f.requests[0].credentials, 'omit');
    assert.equal(f.drive.pending, false);
});

test('consent denial and a closed popup do not leave a pending login', async () => {
    const f = fixture();
    let pending = f.drive.connect();
    await f.oauth.callback({error: 'access_denied'});
    await assert.rejects(pending, /annullata o negata/);
    assert.equal(f.drive.pending, false);
    pending = f.drive.connect();
    f.oauth.error_callback({type: 'popup_closed'});
    await assert.rejects(pending, /interrotto/);
    assert.equal(f.drive.pending, false);
    assert.equal(f.requests.length, 0);
});

test('SDK initialization failure allows retry', async () => {
    const f = fixture();
    f.sdkError();
    await assert.rejects(f.drive.connect(), /SDK failed/);
    assert.equal(f.drive.pending, false);
});

test('missing Drive consent clears the token without fetching a profile', async () => {
    const f = fixture();
    f.context.google.accounts.oauth2.hasGrantedAllScopes = () => false;
    const pending = f.drive.connect();
    await f.oauth.callback({access_token: 'test-token', expires_in: 3600});
    await assert.rejects(pending, /permesso/);
    assert.equal(f.drive.token, null);
    assert.equal(f.requests.length, 0);
});

test('expired sessions require a new user gesture and do not send a request', async () => {
    const f = fixture();
    f.authorized();
    f.drive.expiresAt = Date.now() - 1;
    assert.equal(f.drive.connected, false);
    await assert.rejects(f.drive.listProjects(), /scaduta/);
    assert.equal(f.requests.length, 0);
    assert.equal(f.drive.token, null);
});

test('401 clears the session, 403 preserves it and surfaces the Drive error', async () => {
    const f = fixture();
    f.authorized();
    f.context.fetch = async () => new Response('', {status: 401});
    await assert.rejects(f.drive.listProjects(), /scaduta/);
    assert.equal(f.drive.token, null);
    f.authorized();
    f.context.fetch = async () => new Response(
        JSON.stringify({error: {message: 'Storage quota exceeded'}}), {status: 403}
    );
    await assert.rejects(f.drive.listProjects(), /quota exceeded/);
    assert.equal(f.drive.connected, true);
});

test('all project-list pages are fetched with the app-file filter', async () => {
    const f = fixture();
    f.authorized();
    const urls = [];
    f.context.fetch = async url => {
        urls.push(new URL(url));
        return new Response(JSON.stringify(urls.length === 1 ? {
            files: [{id: 'first', name: 'First.xml'}], nextPageToken: 'page-two'
        } : {files: [{id: 'second', name: 'Second.xml'}]}));
    };
    const files = await f.drive.listProjects();
    assert.deepEqual(Array.from(files, x => x.id), ['first', 'second']);
    assert.match(urls[0].searchParams.get('q'), /snapProject/);
    assert.equal(urls[1].searchParams.get('pageToken'), 'page-two');
});

test('reads the selected file by ID without converting its XML', async () => {
    const f = fixture();
    f.authorized();
    let called;
    f.context.fetch = async url => {
        called = url;
        return new Response('<project name="Città"/>');
    };
    assert.equal(await f.drive.readProject('file/id'), '<project name="Città"/>');
    assert.match(called, /files\/file%2Fid\?alt=media$/);
});

for (const id of [undefined, 'existing-file']) {
    test('resumable upload ' + (id ? 'updates the selected file' : 'creates a new XML file'), async () => {
        const f = fixture();
        f.authorized();
        const requests = [];
        f.context.fetch = async (url, options) => {
            requests.push({url, ...options});
            if (requests.length === 1) {
                return new Response('', {headers: {
                    Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=test'
                }});
            }
            return new Response(JSON.stringify({id: id || 'created-file'}));
        };
        const xml = '<project name="Città">🎈</project>';
        const saved = await f.drive.saveProject('Città.xml', xml, 'Notes', id);
        assert.equal(saved.id, id || 'created-file');
        assert.equal(requests[0].method, id ? 'PATCH' : 'POST');
        if (id) { assert.match(requests[0].url, /files\/existing-file\?/); }
        const metadata = JSON.parse(requests[0].body);
        assert.equal(metadata.name, 'Città.xml');
        assert.equal(metadata.appProperties.snapProject, '1');
        assert.equal(metadata.description, 'Notes');
        assert.equal(requests[1].method, 'PUT');
        assert.equal(await requests[1].body.text(), xml);
    });
}

test('an invalid upload location never receives the access token', async () => {
    const f = fixture();
    f.authorized();
    let count = 0;
    f.context.fetch = async () => {
        count += 1;
        return new Response('', {headers: {Location: 'https://example.com/upload'}});
    };
    await assert.rejects(f.drive.saveProject('Test', '<project/>', ''), /non valido/);
    assert.equal(count, 1);
});

test('disconnect clears local credentials and revokes the token', () => {
    const f = fixture();
    f.authorized();
    f.drive.disconnect();
    assert.equal(f.drive.connected, false);
    assert.equal(f.drive.user, null);
    assert.equal(f.revoked, 'test-token');
});

test('disconnect invalidates an in-flight download', async () => {
    const f = fixture();
    f.authorized();
    let finish;
    f.context.fetch = () => new Promise(resolve => { finish = resolve; });
    const pending = f.drive.readProject('project-id');
    f.drive.disconnect();
    finish(new Response('<project/>'));
    await assert.rejects(pending, /account Google è cambiato/);
});

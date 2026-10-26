/* Google Drive storage for this fork. AGPL-3.0-or-later. */
/*global google */

class GoogleDriveStorage {
    constructor(clientId) {
        this.clientId = clientId || '';
        this.token = null;
        this.expiresAt = 0;
        this.user = null;
        this.pending = false;
        this.session = 0;
        this.onChange = () => {};
    }

    get connected() {
        return Boolean(this.token && this.user && Date.now() < this.expiresAt);
    }

    clearSession() {
        this.token = null;
        this.user = null;
        this.expiresAt = 0;
        this.session += 1;
        this.onChange();
    }

    connect() {
        if (!this.clientId) {
            return Promise.reject(new Error(
                'L’accesso Google non è ancora attivato per questo editor. ' +
                'Puoi continuare a salvare sul dispositivo.'
            ));
        }
        if (location.protocol === 'file:' || !window.isSecureContext) {
            return Promise.reject(new Error(
                'Per accedere a Google apri l’editor tramite HTTPS o localhost.'
            ));
        }
        if (!window.google?.accounts?.oauth2) {
            return Promise.reject(new Error(
                'Accesso Google non disponibile. Verifica la connessione ' +
                'e ricarica la pagina.'
            ));
        }
        if (this.pending) {
            return Promise.reject(new Error('Accesso Google già in corso.'));
        }
        this.pending = true;
        const session = this.session;
        return new Promise((resolve, reject) => {
            const fail = error => {
                this.pending = false;
                reject(error);
            };
            let client;
            try {
                client = google.accounts.oauth2.initTokenClient({
                    client_id: this.clientId,
                    scope: 'https://www.googleapis.com/auth/drive.file',
                    include_granted_scopes: false,
                    callback: async response => {
                        if (response.error || !response.access_token) {
                            fail(new Error('Autorizzazione Google annullata o negata.'));
                            return;
                        }
                        if (session !== this.session) {
                            fail(new Error('Accesso Google annullato.'));
                            return;
                        }
                        this.clearSession();
                        const activeSession = this.session;
                        try {
                            const lifetime = Number(response.expires_in);
                            if (!Number.isFinite(lifetime) || lifetime <= 30) {
                                throw new Error('La sessione Google ricevuta non è valida. Riprova.');
                            }
                            this.token = response.access_token;
                            this.expiresAt = Date.now() + (lifetime - 30) * 1000;
                            if (!google.accounts.oauth2.hasGrantedAllScopes(
                                response, 'https://www.googleapis.com/auth/drive.file'
                            )) {
                                throw new Error('Il permesso per Google Drive non è stato concesso.');
                            }
                            const result = await this.request(
                                'https://www.googleapis.com/drive/v3/about?' +
                                'fields=user(displayName,emailAddress,permissionId)'
                            );
                            const profile = await result.json();
                            if (activeSession !== this.session) {
                                throw new Error('Accesso Google annullato.');
                            }
                            this.user = profile.user;
                            if (!this.user?.permissionId) {
                                throw new Error('Impossibile identificare l’account Drive.');
                            }
                            this.onChange();
                            this.pending = false;
                            resolve(this.user);
                        } catch (error) {
                            if (activeSession === this.session) { this.clearSession(); }
                            fail(error);
                        }
                    },
                    error_callback: () => fail(new Error(
                        'Accesso Google interrotto. Consenti il popup e riprova.'
                    ))
                });
            } catch (error) {
                fail(error);
                return;
            }
            // Keep the popup request in the original click/touch call stack.
            try {
                client.requestAccessToken({prompt: 'select_account'});
            } catch (error) {
                fail(error);
            }
        });
    }

    disconnect() {
        const token = this.token;
        this.clearSession();
        if (token && window.google?.accounts?.oauth2) {
            try {
                google.accounts.oauth2.revoke(token, () => {});
            } catch (error) {
                // Local sign-out must work even when Google is unreachable.
            }
        }
    }

    async request(url, options = {}) {
        if (!this.token || Date.now() >= this.expiresAt) {
            this.clearSession();
            throw new Error('Sessione Google scaduta. Accedi nuovamente dal menu Google Drive.');
        }
        const session = this.session;
        const response = await fetch(url, {
            ...options,
            credentials: 'omit',
            headers: {...options.headers, Authorization: 'Bearer ' + this.token}
        });
        if (session !== this.session) {
            throw new Error('L’account Google è cambiato. Riprova.');
        }
        if (response.status === 401) {
            this.clearSession();
            throw new Error('Sessione Google scaduta. Accedi nuovamente.');
        }
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message ||
                'Google Drive non disponibile (' + response.status + ').');
        }
        return response;
    }

    async listProjects() {
        const session = this.session;
        const files = [];
        let pageToken = '';
        do {
            const params = new URLSearchParams({
                q: "trashed = false and appProperties has { key='snapProject' and value='1' }",
                fields: 'nextPageToken,files(id,name,modifiedTime,description)',
                orderBy: 'modifiedTime desc', pageSize: '100'
            });
            if (pageToken) { params.set('pageToken', pageToken); }
            const response = await this.request(
                'https://www.googleapis.com/drive/v3/files?' + params
            );
            const page = await response.json();
            if (session !== this.session) {
                throw new Error('L’account Google è cambiato. Riapri l’elenco.');
            }
            files.push(...(page.files || []));
            pageToken = page.nextPageToken;
        } while (pageToken);
        return files;
    }

    async readProject(id) {
        const response = await this.request(
            'https://www.googleapis.com/drive/v3/files/' +
            encodeURIComponent(id) + '?alt=media'
        );
        return response.text();
    }

    async saveProject(name, xml, notes, id) {
        // Resumable upload supports projects with large embedded media too.
        const session = this.session;
        const suffix = id ? '/' + encodeURIComponent(id) : '';
        const response = await this.request(
            'https://www.googleapis.com/upload/drive/v3/files' + suffix +
            '?uploadType=resumable&fields=id,name,modifiedTime',
            {
                method: id ? 'PATCH' : 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Upload-Content-Type': 'application/xml'
                },
                body: JSON.stringify({
                    name: name.replace(/\.xml$/i, '') + '.xml',
                    mimeType: 'application/xml',
                    description: notes || '',
                    appProperties: {snapProject: '1'}
                })
            }
        );
        const uploadURL = new URL(response.headers.get('Location'));
        if (uploadURL.origin !== 'https://www.googleapis.com' ||
                !uploadURL.pathname.startsWith('/upload/drive/v3/files')) {
            throw new Error('Google Drive ha restituito un indirizzo di caricamento non valido.');
        }
        if (session !== this.session) {
            throw new Error('L’account Google è cambiato. Salvataggio interrotto.');
        }
        const uploaded = await this.request(uploadURL.href, {
            method: 'PUT', headers: {'Content-Type': 'application/xml'},
            body: new Blob([xml], {type: 'application/xml'})
        });
        return uploaded.json();
    }
}

window.GoogleDriveStorage = GoogleDriveStorage;

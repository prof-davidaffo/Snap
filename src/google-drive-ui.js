/* Google Drive integration with the Snap! editor. AGPL-3.0-or-later. */
/*global IDE_Morph, ProjectDialogMorph, MenuMorph, Project, SpriteMorph */

IDE_Morph.prototype.googleDriveError = function (error) {
    this.inform('Google Drive', error.message || String(error));
};

IDE_Morph.prototype.connectGoogleDrive = function (onConnected) {
    if (this.config.noCloud) { return; }
    // connect() opens Google's popup synchronously from the user's gesture.
    this.drive.connect().then(user => {
        this.showMessage('Google Drive: ' + (user.emailAddress || user.displayName), 3);
        if (typeof onConnected === 'function') { onConnected(); }
    }).catch(error => this.googleDriveError(error));
};

IDE_Morph.prototype.googleDriveMenu = function () {
    if (this.config.noCloud) { return; }
    const menu = new MenuMorph(this);
    if (this.drive.connected) {
        menu.addItem('Apri da Google Drive...', 'openGoogleDriveBrowser');
        menu.addItem('Salva su Google Drive...', 'saveGoogleDriveProject');
        menu.addLine();
        menu.addItem('Disconnetti ' +
            (this.drive.user.emailAddress || this.drive.user.displayName),
            () => this.drive.disconnect());
    } else {
        menu.addItem('Accedi con Google...', 'connectGoogleDrive');
    }
    menu.addLine();
    menu.addItem('Norme sulla privacy',
        () => window.open('privacy.html', '_blank', 'noopener'));
    menu.addItem('Termini di servizio',
        () => window.open('terms.html', '_blank', 'noopener'));
    if (this.world().currentKey === 16) {
        menu.addLine();
        [
            ['export project media only...', 'exportProjectMedia'],
            ['export project without media...', 'exportProjectNoMedia'],
            ['export project as cloud data...', 'exportProjectAsCloudData']
        ].forEach(([label, method]) => menu.addItem(label, () => {
            const name = this.getProjectName();
            if (name) { this[method](name); }
            else {
                this.prompt('Export Project As...', value => this[method](value),
                    null, 'exportProject');
            }
        }));
    }
    menu.popup(this.world(), this.controlBar.cloudButton.bottomLeft());
};

IDE_Morph.prototype.openGoogleDriveBrowser = function () {
    if (this.config.noCloud) { return; }
    const open = () => {
        const dialog = new ProjectDialogMorph(this, 'open');
        dialog.source = 'drive';
        dialog.popUp();
        dialog.onNextStep = null;
        dialog.setSource('drive');
    };
    if (this.drive.connected) { open(); }
    else { this.connectGoogleDrive(open); }
};

ProjectDialogMorph.prototype.loadGoogleDriveList = function () {
    const request = this.driveListRequest;
    const load = () => {
        if (!this.parent || this.source !== 'drive' ||
                request !== this.driveListRequest) { return; }
        const session = this.ide.drive.session;
        const message = this.ide.showMessage('Caricamento progetti da Google Drive...');
        this.ide.drive.listProjects().then(files => {
            if (this.parent && this.source === 'drive' &&
                    request === this.driveListRequest && session === this.ide.drive.session) {
                this.setSource('drive', files);
            }
        }).catch(error => {
            if (this.parent && this.source === 'drive' && request === this.driveListRequest) {
                this.setSource('drive', []);
                this.ide.googleDriveError(error);
            }
        }).finally(() => message.destroy());
    };
    if (this.ide.drive.connected) { load(); }
    else {
        // This path is reached by explicitly clicking the Drive source button.
        this.ide.connectGoogleDrive(load);
    }
};

IDE_Morph.prototype.serializeGoogleDriveProject = function () {
    this.scene.captureGlobalSettings();
    try {
        return this.serializer.serialize(new Project(this.scenes, this.scene));
    } finally {
        this.scene.applyGlobalSettings();
    }
};

IDE_Morph.prototype.saveGoogleDriveProject = function (name, destination) {
    if (this.config.noCloud) { return; }
    if (this.driveSaving) {
        this.showMessage('Salvataggio su Google Drive già in corso.', 2);
        return;
    }
    if (!this.drive.connected) {
        this.connectGoogleDrive(() => this.saveGoogleDriveProject(name, destination));
        return;
    }
    if (typeof name !== 'string' || !name.trim()) {
        const currentName = this.getProjectName();
        if (currentName) {
            this.saveGoogleDriveProject(currentName, destination);
        } else {
            this.prompt('Salva su Google Drive', value => {
                if (value?.trim()) { this.saveGoogleDriveProject(value.trim(), destination); }
            }, null, 'googleDriveProject');
        }
        return;
    }
    const account = this.drive.user.permissionId;
    if (destination?.fileId && destination.account !== account) {
        this.googleDriveError(new Error('L’account Google è cambiato. Riapri l’elenco dei progetti.'));
        return;
    }
    const scenes = this.scenes;
    const session = this.drive.session;
    const previous = this.driveFile;
    const id = destination === false ? null : destination?.fileId ||
        (previous?.account === account && previous.scenes === scenes ? previous.id : null);
    let xml;
    try {
        name = this.setProjectName(name);
        xml = this.serializeGoogleDriveProject();
        this.serializer.parse(xml);
    } catch (error) {
        this.googleDriveError(error);
        return;
    }
    const revision = this.storageRevision;
    const message = this.showMessage('Salvataggio su Google Drive...');
    this.driveSaving = true;
    return this.drive.saveProject(name, xml, this.getProjectNotes(), id).then(file => {
        if (!file.id) { throw new Error('Google Drive non ha confermato il salvataggio.'); }
        if (this.drive.session !== session || this.scenes !== scenes) { return; }
        this.driveFile = {id: file.id, account, scenes};
        this.source = 'drive';
        if (this.storageRevision === revision) { this.recordSavedChanges(); }
        this.showMessage('Salvato su Google Drive.', 2);
    }).catch(error => this.googleDriveError(error)).finally(() => {
        this.driveSaving = false;
        message.destroy();
    });
};

IDE_Morph.prototype.openGoogleDriveProject = function (project, addScene = false) {
    if (this.config.noCloud) { return; }
    if (project.account !== this.drive.user?.permissionId) {
        this.googleDriveError(new Error('L’account Google è cambiato. Riapri l’elenco dei progetti.'));
        return;
    }
    const session = this.drive.session;
    const scenes = this.scenes;
    const message = this.showMessage('Apertura da Google Drive...');
    return this.drive.readProject(project.fileId).then(xml => {
        if (this.drive.session !== session || this.scenes !== scenes) {
            throw new Error('Il progetto o l’account è cambiato. Riapri l’elenco.');
        }
        const parsed = this.serializer.parse(xml);
        if (parsed.tag !== 'project') {
            throw new Error('Il file selezionato non è un progetto Snap! XML.');
        }
        const open = () => {
            if (session !== this.drive.session || !this.drive.connected || scenes !== this.scenes) {
                this.googleDriveError(new Error('Il progetto o l’account è cambiato. Riapri l’elenco.'));
                return;
            }
            const wasAddingScenes = this.isAddingScenes;
            try {
                this.isAddingScenes = addScene || wasAddingScenes;
                this.isAddingNextScene = false;
                if (!addScene) { SpriteMorph.prototype.initBlocks(); }
                if (this.rawOpenProjectString(xml) === false) { return; }
                if (!addScene) {
                    this.driveFile = {
                        id: project.fileId,
                        account: this.drive.user.permissionId,
                        scenes: this.scenes
                    };
                    this.source = 'drive';
                    this.recordSavedChanges();
                    location.hash = '';
                }
            } catch (error) {
                this.googleDriveError(error);
            } finally {
                this.isAddingScenes = wasAddingScenes;
            }
        };
        if (addScene) { open(); }
        else { this.backup(open); }
    }).catch(error => this.googleDriveError(error)).finally(() => message.destroy());
};

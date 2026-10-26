const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ui = fs.readFileSync(path.join(__dirname, '../src/google-drive-ui.js'), 'utf8');
const gui = fs.readFileSync(path.join(__dirname, '../src/gui.js'), 'utf8');
function fixture() {
    const messages = [], errors = [], uploads = [];
    let saved = 0;
    const context = {
        IDE_Morph: function () {},
        ProjectDialogMorph: function () {},
        Project: function () {},
        SpriteMorph: function () {},
        MenuMorph: function () {},
        localize: x => x,
        location: {hash: ''}
    };
    context.SpriteMorph.prototype.initBlocks = () => {};
    vm.createContext(context);
    vm.runInContext(ui, context);
    // Exercise the real Save dispatch and project-dialog save action as well.
    for (const [start, end] of [
        ['IDE_Morph.prototype.save =', 'IDE_Morph.prototype.exportProject ='],
        ['ProjectDialogMorph.prototype.saveProject =', 'ProjectDialogMorph.prototype.deleteProject =']
    ]) {
        vm.runInContext(gui.slice(gui.indexOf(start), gui.indexOf(end)), context);
    }
    const ide = new context.IDE_Morph();
    ide.config = {};
    ide.scenes = {};
    ide.scene = {captureGlobalSettings() {}, applyGlobalSettings() {}};
    ide.storageRevision = 1;
    ide.cloud = {disabled: true};
    ide.source = 'disk';
    ide.name = 'Test';
    ide.drive = {
        connected: true, user: {permissionId: 'account-a'}, session: 1,
        async saveProject(...args) {
            uploads.push(args);
            return {id: args[3] || 'new-file'};
        },
        async readProject() { return '<project/>'; }
    };
    ide.getProjectName = () => ide.name;
    ide.setProjectName = name => { ide.name = name; return name; };
    ide.getProjectNotes = () => 'Notes';
    ide.setProjectNotes = () => {};
    ide.serializer = {serialize: () => '<project/>', parse: () => ({tag: 'project'})};
    ide.showMessage = text => { messages.push(text); return {destroy() {}}; };
    ide.inform = (_, text) => errors.push(text);
    ide.recordSavedChanges = () => { saved += 1; };
    ide.backup = action => action();
    ide.rawOpenProjectString = () => { ide.scenes = {}; return true; };
    const selected = {fileId: 'opened-file', name: 'Test', account: 'account-a'};
    return {ide, context, messages, errors, uploads, selected,
        get saved() { return saved; }};
}

test('Save dispatch keeps XML download and Drive destinations distinct', async () => {
    const f = fixture();
    f.ide.exportProject = () => { f.exported = true; };
    f.ide.saveProjectsBrowser = () => { throw new Error('Unexpected dialog'); };
    f.ide.save();
    assert.equal(f.exported, true);
    assert.equal(f.uploads.length, 0);
    f.ide.source = 'drive';
    f.ide.save();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.uploads.length, 1);
});

test('saving an associated project updates the existing Drive file', async () => {
    const f = fixture();
    f.ide.driveFile = {id: 'existing', account: 'account-a', scenes: f.ide.scenes};
    await f.ide.saveGoogleDriveProject('Test');
    assert.equal(f.uploads[0][3], 'existing');
    assert.equal(f.ide.driveFile.id, 'existing');
    assert.equal(f.ide.source, 'drive');
    assert.equal(f.saved, 1);
});

test('a different account or project cannot reuse a prior file ID', async () => {
    for (const previous of [
        {account: 'account-b'}, {account: 'account-a', scenes: {}}
    ]) {
        const f = fixture();
        f.ide.driveFile = {id: 'wrong-file', scenes: f.ide.scenes, ...previous};
        await f.ide.saveGoogleDriveProject('Test');
        assert.equal(f.uploads[0][3], null);
    }
});

test('Save As creates a copy unless the user explicitly selected a destination', async () => {
    const f = fixture();
    f.ide.driveFile = {id: 'old-file', account: 'account-a', scenes: f.ide.scenes};
    await f.ide.saveGoogleDriveProject('Copy', false);
    assert.equal(f.uploads[0][3], null);
    await f.ide.saveGoogleDriveProject('Test', f.selected);
    assert.equal(f.uploads[1][3], 'opened-file');
});

test('a stale destination from a different account is rejected before upload', async () => {
    const f = fixture();
    await f.ide.saveGoogleDriveProject('Test', {...f.selected, account: 'account-b'});
    assert.equal(f.uploads.length, 0);
    assert.match(f.errors[0], /account Google è cambiato/);
});

test('failed uploads preserve unsaved status and local saving stays available', async () => {
    const f = fixture();
    f.ide.drive.saveProject = async () => { throw new Error('Offline'); };
    await f.ide.saveGoogleDriveProject('Test');
    assert.equal(f.saved, 0);
    assert.equal(f.ide.source, 'disk');
    assert.equal(f.ide.driveSaving, false);
    assert.equal(f.errors[0], 'Offline');
});

test('edits made during upload remain unsaved', async () => {
    const f = fixture();
    let finish;
    f.ide.drive.saveProject = () => new Promise(resolve => { finish = resolve; });
    const pending = f.ide.saveGoogleDriveProject('Test');
    f.ide.storageRevision += 1;
    finish({id: 'saved-snapshot'});
    await pending;
    assert.equal(f.saved, 0);
    assert.equal(f.ide.driveFile.id, 'saved-snapshot');
});

test('switching projects during upload does not attach the old file to the new project', async () => {
    const f = fixture();
    let finish;
    f.ide.drive.saveProject = () => new Promise(resolve => { finish = resolve; });
    const pending = f.ide.saveGoogleDriveProject('Test');
    f.ide.scenes = {};
    finish({id: 'old-project'});
    await pending;
    assert.equal(f.saved, 0);
    assert.equal(f.ide.driveFile, undefined);
    assert.equal(f.ide.source, 'disk');
});

test('serialization failure restores scene settings and does not upload', async () => {
    const f = fixture();
    let restored = false;
    f.ide.scene.applyGlobalSettings = () => { restored = true; };
    f.ide.serializer.serialize = () => { throw new Error('Serialization failed'); };
    await f.ide.saveGoogleDriveProject('Test');
    assert.equal(restored, true);
    assert.equal(f.uploads.length, 0);
    assert.equal(f.saved, 0);
});

test('Drive opening honors the existing backup/confirmation flow', async () => {
    const f = fixture();
    let open, called = false;
    f.ide.backup = action => { called = true; open = action; };
    await f.ide.openGoogleDriveProject(f.selected);
    assert.equal(called, true);
    assert.equal(f.ide.driveFile, undefined);
    open();
    assert.equal(f.ide.driveFile.id, 'opened-file');
    assert.equal(f.ide.driveFile.scenes, f.ide.scenes);
    assert.equal(f.ide.source, 'drive');
});

test('adding scenes from Drive appends without replacing the current project', async () => {
    const f = fixture();
    const scenes = f.ide.scenes;
    f.ide.rawOpenProjectString = () => {
        assert.equal(f.ide.isAddingScenes, true);
        return true;
    };
    await f.ide.openGoogleDriveProject(f.selected, true);
    assert.equal(f.ide.scenes, scenes);
    assert.equal(f.ide.driveFile, undefined);
    assert.equal(f.ide.source, 'disk');
    assert.equal(f.saved, 0);
});

test('invalid files and failed deserialization cannot mark a project as saved', async () => {
    const f = fixture();
    f.ide.serializer.parse = () => ({tag: 'blocks'});
    await f.ide.openGoogleDriveProject(f.selected);
    assert.match(f.errors[0], /non è un progetto/);
    f.ide.serializer.parse = () => ({tag: 'project'});
    f.ide.rawOpenProjectString = () => false;
    await f.ide.openGoogleDriveProject(f.selected);
    assert.equal(f.saved, 0);
    assert.equal(f.ide.driveFile, undefined);
});

test('switching accounts during download cannot open the old account’s file', async () => {
    const f = fixture();
    let finish;
    f.ide.drive.readProject = () => new Promise(resolve => { finish = resolve; });
    const pending = f.ide.openGoogleDriveProject(f.selected);
    f.ide.drive.session += 1;
    finish('<project/>');
    await pending;
    assert.equal(f.ide.driveFile, undefined);
    assert.equal(f.saved, 0);
    assert.match(f.errors[0], /account è cambiato/);
});

test('stale project-list results do not replace a different source', async () => {
    const f = fixture();
    const dialog = new f.context.ProjectDialogMorph();
    let finish;
    f.ide.drive.listProjects = () => new Promise(resolve => { finish = resolve; });
    Object.assign(dialog, {
        ide: f.ide, parent: {}, source: 'drive', driveListRequest: 1,
        setSource() { throw new Error('Stale result installed'); }
    });
    dialog.loadGoogleDriveList();
    dialog.source = 'examples';
    finish([]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.errors.length, 0);
});

test('Save As asks before overwriting the specifically selected Drive file', () => {
    const f = fixture();
    const dialog = new f.context.ProjectDialogMorph();
    let confirm, destination;
    f.ide.confirm = (_, __, action) => { confirm = action; };
    f.ide.saveGoogleDriveProject = (name, selected) => { destination = selected; };
    Object.assign(dialog, {
        ide: f.ide, source: 'drive', listField: {selected: f.selected},
        nameField: {contents: () => ({text: {text: 'Test'}})},
        notesText: {text: 'Notes'}, destroy() {}
    });
    dialog.saveProject();
    assert.equal(destination, undefined);
    confirm();
    assert.equal(destination, f.selected);
});

test('Save As on Computer retains the existing XML exporter', () => {
    const f = fixture();
    const dialog = new f.context.ProjectDialogMorph();
    let exported;
    f.ide.exportProject = name => { exported = name; };
    Object.assign(dialog, {
        ide: f.ide, source: 'disk',
        nameField: {contents: () => ({text: {text: 'Local'}})},
        notesText: {text: 'Notes'}, destroy() {}
    });
    dialog.saveProject();
    assert.equal(exported, 'Local');
    assert.equal(f.ide.source, 'disk');
});

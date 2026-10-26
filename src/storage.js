/* Local compatibility helpers for upstream Snap! code. AGPL-3.0-or-later.
 * The Snap!Cloud network client is intentionally not included in this fork.
 */
function Cloud() {
    this.disabled = true;
    this.username = null;
}

Cloud.prototype.disable = function () { this.disabled = true; };
// Retain the URL block's existing protection for Snap account endpoints.
Cloud.prototype.knownDomains = {
    production: 'https://snap.berkeley.edu',
    cs10: 'https://snap-cloud.cs10.org',
    staging: 'https://snap-staging.cs10.org'
};
Cloud.prototype.parseDict = function (source) {
    const dict = {};
    (source || '').split('&').filter(Boolean).forEach(entry => {
        const index = entry.indexOf('=');
        const key = index < 0 ? entry : entry.slice(0, index);
        const value = index < 0 ? '' : entry.slice(index + 1);
        dict[decodeURIComponent(key)] = decodeURIComponent(value);
    });
    return dict;
};
Cloud.prototype.encodeDict = function (dict) {
    return Object.keys(dict || {}).map(key =>
        encodeURIComponent(key) + '=' + encodeURIComponent(dict[key])
    ).join('&');
};

/* The account page: the apps the user connected (Sign in with threepipe, src/connect.ts) and the access links of their
   agents (src/access.ts), from /api/v1/access-links; revoking one stops its keys at once. Names and app addresses are
   user input: every one goes through esc(); events are bound by data attributes. Loaded as a module. */
'use strict'
const {el, esc, icon, toast, stamp, short} = UI
const S = {links: null, err: ''}
const idOf = s => /^[\w-]{1,64}$/.test(String(s || '')) ? String(s) : ''

async function api(path, init) {
    const r = await fetch('/api/v1/access-links' + path, {...init, credentials: 'same-origin'})
    if (r.status === 401) { signedOut(); throw new Error('signed out') }
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.message || j.error || ('HTTP ' + r.status))
    return j
}
function signedOut() {
    el('app').hidden = true; el('login').hidden = false
    UI.login(el('login'), {title: 'Sign in to your account', text: 'The apps you connected to threepipe cloud, and the access links of your agents.', redirect: '/account'})
}

async function load() {
    try { S.links = (await api('')).links; S.err = ''; el('login').hidden = true; el('app').hidden = false }
    catch (e) { if (e.message === 'signed out') return; S.links = null; S.err = e.message }
    UI.side('account', '')
    render()
}
const when = s => s ? '<span title="' + esc(stamp(s)) + '">' + esc(short(s)) + '</span>' : '<span class="muted">Never</span>'
const revoke = l => '<button class="danger" data-revoke="' + esc(idOf(l.id)) + '">Revoke</button>'
function render() {
    if (!S.links) { el('list').innerHTML = '<div class="empty"><p class="err">' + esc(S.err || 'Reading…') + '</p></div>'; return }
    const apps = S.links.filter(l => l.app), agents = S.links.filter(l => !l.app)
    const appRows = apps.map(l => '<tr><td><div class="name"><span class="ft">' + icon('grid') + '</span><div><div class="t">' + esc(l.app) + '</div>'
        + '<div class="s">' + (l.app_owner ? 'Served by @' + esc(l.app_owner) : 'On your computer') + '</div></div></div></td>'
        + '<td>' + (l.access === 'drive' ? '<span class="pill c-waiting_reporter">Whole drive</span>' : '<span class="pill">' + icon('folder') + esc(l.folder && l.folder.name || 'Its folder') + '</span>') + '</td>'
        + '<td class="hide-sm">' + when(l.created) + '</td><td class="hide-sm">' + when(l.last_used) + '</td><td class="right">' + revoke(l) + '</td></tr>').join('')
    const agentRows = agents.map(l => '<tr><td><div class="name"><span class="ft">' + icon('key') + '</span><div><div class="t">' + (l.name ? esc(l.name) : '<span class="muted">No name</span>') + '</div></div></div></td>'
        + '<td class="hide-sm">' + when(l.created) + '</td><td class="hide-sm">' + when(l.last_used) + '</td><td class="right">' + revoke(l) + '</td></tr>').join('')
    el('list').innerHTML = '<h2 class="group-h">Connected apps</h2><p class="intro">Apps you allowed to use your drive with Sign in with threepipe. Revoking stops the app at once; its folder and files stay.</p>'
        + (apps.length ? '<table class="list"><colgroup><col><col class="w160"><col class="w110 hide-sm"><col class="w110 hide-sm"><col class="w96"></colgroup>'
            + '<thead><tr><th>App</th><th>Can use</th><th class="hide-sm">Allowed</th><th class="hide-sm">Last used</th><th></th></tr></thead><tbody>' + appRows + '</tbody></table>'
            : '<p class="intro muted">No apps yet.</p>')
        + '<h2 class="group-h">Access links</h2><p class="intro">For agents and scripts (Claude Code, CI): the link\'s agents.md says how to get a key that acts as you for 30 days. Revoking stops every key from that link.</p>'
        + (agents.length ? '<table class="list"><colgroup><col><col class="w110 hide-sm"><col class="w110 hide-sm"><col class="w96"></colgroup>'
            + '<thead><tr><th>Name</th><th class="hide-sm">Created</th><th class="hide-sm">Last used</th><th></th></tr></thead><tbody>' + agentRows + '</tbody></table>'
            : '<p class="intro muted">No access links yet.</p>')
}

async function newLink() {
    const name = await UI.prompt('New access link', '', {placeholder: 'Name: laptop, CI, …', ok: 'Create', text: 'Anyone with the link can act as you; give it only to your own agents.'})
    if (name === null) return
    let link
    try { link = await fetch('/api/v1/access-links', {method: 'POST', credentials: 'same-origin', headers: {'content-type': 'application/json'}, body: JSON.stringify({name})})
        .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || 'HTTP ' + r.status); return j }) }
    catch (e) { toast('Could not create the link: ' + e.message, true); return }
    await load()
    // the link is shown once: only its hash is stored
    await UI.dialog({title: 'Copy the link now', text: 'It is shown only once. Give it to your agent: it reads the instructions there.', ok: 'Done',
        body: '<div class="field"><input readonly data-link value="' + esc(link.url) + '"><button type="button" data-copy-new>' + icon('copy') + 'Copy</button></div>',
        mount: d => d.querySelector('[data-copy-new]').addEventListener('click', () => navigator.clipboard.writeText(link.url).then(() => toast('Link copied'), e => toast(e.message, true)))})
}

document.addEventListener('click', async e => {
    const t = e.target.closest('[data-new-link],[data-revoke]')
    if (!t || t.closest('dialog,#side')) return
    if (t.hasAttribute('data-new-link')) { newLink(); return }
    const l = S.links && S.links.find(x => x.id === idOf(t.getAttribute('data-revoke'))); if (!l) return
    if (!await UI.confirm('Revoke ' + (l.app || l.name || 'this link') + '?', l.app ? 'The app stops working with your drive now. Its folder and files stay; it can ask you again.' : 'Every key from this link stops working now.', {ok: 'Revoke'})) return
    try { await api('/' + encodeURIComponent(l.id), {method: 'DELETE'}); toast('Revoked') } catch (e) { if (e.message !== 'signed out') toast('Could not revoke: ' + e.message, true) }
    load()
})
document.querySelector('[data-new-link]').innerHTML = icon('plus') + 'New access link'
load()

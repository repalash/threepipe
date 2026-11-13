import {DatabaseSettings, sqlValue, TableAuthExtensionData, TableRulesExtensionData} from 'teenybase'
import {baseFields, authFields, createdTrigger, updatedTrigger} from 'teenybase/scaffolds/fields'

// The username is the handle: the user's drive is `d/<username>/`, so it is picked once and never changes.
// `handle_set`: when it was picked (src/handle.ts). GitHub gives its login and a password sign-up names it; a Google
// sign-up has none (teenybase makes one from the email), so the user picks it on the first visit. Only the Worker writes it.
const userFields = [
    ...authFields.map(f => f.name === 'username' ? {...f, noUpdate: true} : f),
    {name: 'handle_set', type: 'text', sqlType: 'text', noInsert: true, noUpdate: true},
]

/**
 * threepipe cloud: users (GitHub or Google sign-in), access links for agents and scripts, and the registry of uploaded files.
 * The files themselves are in R2 and served without a database read (src/files.ts); the routes that write them are in src/uploads.ts.
 * `role` is 'member' (default), 'staff', 'admin' or 'blocked' (every route refuses the account), set by an admin. `username` is the handle (account prefix).
 * `users.meta` is writable by the user and goes into their session JWT: only use JWT meta to restrict a token, never to grant.
 */
export default {
    appName: 'threepipe cloud',
    // a literal URL: teenybase resolves $NAME only in secret fields (an OAuth sign-in returns here when no redirect is given)
    appUrl: 'https://cloud.threepipe.org',
    jwtSecret: '$JWT_SECRET',
    authCookie: {name: 'tp_cloud_auth'}, // host-only on cloud.threepipe.org, never on the parent domain
    authProviders: [
        {name: 'github', clientId: '$GITHUB_CLIENT_ID', clientSecret: '$GITHUB_CLIENT_SECRET'},
        // Google: links to an account with the same (verified) email; a new user picks a handle first (src/handle.ts)
        {name: 'google', clientId: '$GOOGLE_CLIENT_ID', clientSecret: '$GOOGLE_CLIENT_SECRET'},
    ],
    tables: [{
        name: 'users',
        autoSetUid: true,
        fields: [...baseFields, ...userFields],
        triggers: [createdTrigger, updatedTrigger],
        extensions: [
            {
                name: 'auth',
                passwordType: 'sha256',
                jwtSecret: '$JWT_SECRET_USERS',
                jwtTokenDuration: 3600,
                maxTokenRefresh: 5,
                passwordConfirmSuffix: 'Confirm',
            } as TableAuthExtensionData,
            {
                name: 'rules',
                listRule: 'auth.uid == id',
                viewRule: 'auth.uid == id',
                createRule: 'true',
                updateRule: 'auth.uid == id',
                deleteRule: 'auth.uid == id',
            } as TableRulesExtensionData,
        ],
    }, {
        // One per agent/machine, or per app the user connected (src/connect.ts). The code is only in the link the user
        // copies; this table keeps its hash. Created by POST /api/v1/access-links (src/access.ts) and the connect page;
        // the owner lists and deletes (revokes) them here.
        name: 'access_links',
        autoSetUid: true,
        fields: [
            ...baseFields,
            {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
            {name: 'name', type: 'text', sqlType: 'text'},
            {name: 'code_hash', type: 'text', sqlType: 'text', notNull: true, unique: true, noSelect: true},
            {name: 'last_used', type: 'text', sqlType: 'text'},
            // apps only: the app (`p/<name>`, `d/<handle>/<app>`, `localhost:<port>`, ...) and the drive folder its key may use
            {name: 'app', type: 'text', sqlType: 'text'},
            {name: 'scope', type: 'text', sqlType: 'text'},
            // who served the app when it was approved: the grant only applies while the same user owns that scope
            {name: 'app_owner', type: 'text', sqlType: 'text'},
        ],
        triggers: [createdTrigger, updatedTrigger],
        extensions: [{
            name: 'rules',
            listRule: 'auth.uid == owner_id',
            viewRule: 'auth.uid == owner_id',
            createRule: null,
            updateRule: null,
            deleteRule: 'auth.uid == owner_id',
        } as TableRulesExtensionData],
    }, {
        // The files of drive items (src/drive.ts) and of the staff buckets (src/buckets.ts); never read when a file is served.
        // s/ b/ p/ a/ uploads have no rows: their owner and expiry are on the R2 objects (src/uploads.ts).
        name: 'files',
        autoSetUid: true,
        fields: [
            ...baseFields,
            {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
            {name: 'bucket', type: 'text', sqlType: 'text', notNull: true},
            {name: 'prefix', type: 'text', sqlType: 'text', notNull: true},
            {name: 'path', type: 'text', sqlType: 'text', notNull: true},
            {name: 'size', type: 'integer', sqlType: 'integer', notNull: true},
            {name: 'sha256', type: 'text', sqlType: 'text'},
            {name: 'content_type', type: 'text', sqlType: 'text'},
            // drive (d/) only: the item the file belongs to, and when R2 stored the version the row describes (two
            // uploads to one path: the newer object's details win, whichever request registers last)
            {name: 'item_id', type: 'text', sqlType: 'text'},
            {name: 'version', type: 'text', sqlType: 'text'},
            {name: 'deleted_at', type: 'text', sqlType: 'text'},
            {name: 'deleted_by', type: 'text', sqlType: 'text'},
            {name: 'deleted_reason', type: 'text', sqlType: 'text'},
        ],
        indexes: [
            {fields: ['bucket', 'path'], unique: true},
            {fields: ['owner_id', 'prefix']},
            {fields: 'item_id', where: {q: 'item_id IS NOT NULL'}},
        ],
        triggers: [createdTrigger, updatedTrigger],
        extensions: [{
            name: 'rules',
            listRule: 'auth.uid == owner_id',
            viewRule: 'auth.uid == owner_id',
            createRule: null,
            updateRule: null,
            deleteRule: null,
        } as TableRulesExtensionData],
    }, {
        // Who owns an upload scope (`s/<slug>`, `p/<name>`, `b/<repo>/<ref>`): claimed by the first upload (the unique
        // index), read with the user in one query (src/auth.ts requireUserAndScope, src/uploads.ts). One row per scope, none per
        // file. `expires_at`: a share's last file expiry, after which another user may claim the slug; null for b/ and p/.
        name: 'scopes',
        autoSetUid: true,
        fields: [
            ...baseFields,
            {name: 'scope', type: 'text', sqlType: 'text', notNull: true, unique: true},
            {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
            {name: 'expires_at', type: 'text', sqlType: 'text'},
        ],
        triggers: [createdTrigger, updatedTrigger],
        extensions: [{
            name: 'rules',
            listRule: 'auth.uid == owner_id',
            viewRule: 'auth.uid == owner_id',
            createRule: null,
            updateRule: null,
            deleteRule: null,
        } as TableRulesExtensionData],
    }, {
        // Drive folders (src/drive.ts): the name is a label, the id never changes, so renaming or moving a folder is one row.
        // parent_id '' is the root. `app` marks the folder made for an app on connect (src/connect.ts), to find it again.
        name: 'drive_folders',
        autoSetUid: true,
        fields: [
            ...baseFields,
            {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
            {name: 'parent_id', type: 'text', sqlType: 'text', notNull: true},
            {name: 'name', type: 'text', sqlType: 'text', notNull: true},
            {name: 'app', type: 'text', sqlType: 'text'},
        ],
        indexes: [{fields: ['owner_id', 'parent_id', 'name'], unique: true}, {fields: ['owner_id', 'app']}],
        triggers: [createdTrigger, updatedTrigger],
        extensions: [{
            name: 'rules',
            listRule: 'auth.uid == owner_id',
            viewRule: 'auth.uid == owner_id',
            createRule: null,
            updateRule: null,
            deleteRule: null,
        } as TableRulesExtensionData],
    }, {
        // Drive items: one upload, a file or a folder of files that belong together. The id is in the R2 keys
        // (d/<handle>/<id>/<name at upload or relative path>) and never changes; name and folder are labels here.
        // visibility: private (signed URLs) | link (anyone with the item URL). entry: the file the item URL opens.
        name: 'drive_items',
        autoSetUid: false,
        fields: [
            baseFields[0], baseFields[1], baseFields[2],
            {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
            {name: 'folder_id', type: 'text', sqlType: 'text', notNull: true},
            {name: 'name', type: 'text', sqlType: 'text', notNull: true},
            {name: 'entry', type: 'text', sqlType: 'text'},
            {name: 'visibility', type: 'text', sqlType: 'text', notNull: true, default: sqlValue('private')},
        ],
        indexes: [{fields: ['owner_id', 'folder_id', 'name'], unique: true}],
        triggers: [createdTrigger, updatedTrigger],
        extensions: [{
            name: 'rules',
            listRule: 'auth.uid == owner_id',
            viewRule: 'auth.uid == owner_id',
            createRule: null,
            updateRule: null,
            deleteRule: null,
        } as TableRulesExtensionData],
    }, {
        // A user's own limits, above (or below) their role's (src/limits.ts). Set by an admin (admin panel or the admin
        // API); not in users, whose rows the user can edit. A NULL column keeps the role's limit.
        name: 'user_limits',
        autoSetUid: true,
        fields: [
            ...baseFields,
            {name: 'user_id', type: 'relation', sqlType: 'text', notNull: true, unique: true, foreignKey: {table: 'users', column: 'id'}},
            {name: 'drive_quota', type: 'integer', sqlType: 'integer'}, // bytes
            {name: 'projects', type: 'integer', sqlType: 'integer'}, // projects they may own
            {name: 'reports_daily', type: 'integer', sqlType: 'integer'}, // reports they may send in 24 hours
            {name: 'note', type: 'text', sqlType: 'text'}, // why, for the next admin
        ],
        triggers: [createdTrigger, updatedTrigger],
        extensions: [{
            name: 'rules',
            listRule: null,
            viewRule: null,
            createRule: null,
            updateRule: null,
            deleteRule: null,
        } as TableRulesExtensionData],
    }, {
        // Projects: where an app's reports go (src/projects.ts). Read and changed only through those routes.
        name: 'projects',
        autoSetUid: true,
        fields: [
            ...baseFields,
            {name: 'slug', type: 'text', sqlType: 'text', notNull: true, unique: true},
            {name: 'name', type: 'text', sqlType: 'text', notNull: true},
            {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
            {name: 'discord_webhook', type: 'text', sqlType: 'text', noSelect: true},
        ],
        indexes: [{fields: ['owner_id']}],
        triggers: [createdTrigger, updatedTrigger],
        extensions: [{
            name: 'rules',
            listRule: null,
            viewRule: null,
            createRule: null,
            updateRule: null,
            deleteRule: null,
        } as TableRulesExtensionData],
    }, {
        name: 'project_members',
        autoSetUid: true,
        fields: [
            ...baseFields,
            {name: 'project_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'projects', column: 'id'}},
            {name: 'user_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
            {name: 'role', type: 'text', sqlType: 'text', notNull: true}, // reader | manager (the owner is projects.owner_id)
        ],
        indexes: [{fields: ['project_id', 'user_id'], unique: true}, {fields: ['user_id']}],
        triggers: [createdTrigger, updatedTrigger],
        extensions: [{
            name: 'rules',
            listRule: null,
            viewRule: null,
            createRule: null,
            updateRule: null,
            deleteRule: null,
        } as TableRulesExtensionData],
    }, {
        // Reports (src/reports.ts). The row holds what the list shows and what the caps count; the report
        // itself is reports/<key>/report.json in R2, the screenshot and files beside it. R2 keys use `key`, never the
        // public id. Nothing deletes a row: a delete removes the R2 objects and clears the personal columns.
        name: 'reports',
        autoSetUid: false,
        fields: [
            baseFields[0], // id: the public 'R-' + 6 Crockford base32 characters
            {name: 'project_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'projects', column: 'id'}},
            {name: 'key', type: 'text', sqlType: 'text', notNull: true}, // random uuid; the R2 keys use it
            {name: 'client_key', type: 'text', sqlType: 'text', notNull: true}, // the dialog's Idempotency-Key
            {name: 'created_at', type: 'text', sqlType: 'text', notNull: true}, // ISO 8601 UTC
            {name: 'origin', type: 'text', sqlType: 'text'}, // host of the Origin header
            {name: 'type', type: 'text', sqlType: 'text', notNull: true}, // bug | question | idea | other
            {name: 'surface', type: 'text', sqlType: 'text', notNull: true}, // where the dialog opened: modelling-editor, examples, …
            {name: 'email', type: 'text', sqlType: 'text'}, // as typed, not verified
            {name: 'user_id', type: 'text', sqlType: 'text'}, // the signed-in sender
            {name: 'rate_key', type: 'text', sqlType: 'text', notNull: true}, // u:<user id>, or ip:<keyed hash of the IP>; the daily caps count it
            {name: 'summary', type: 'text', sqlType: 'text'}, // the first 200 characters of the text
            {name: 'cause', type: 'text', sqlType: 'text'},
            {name: 'versions_json', type: 'text', sqlType: 'text', notNull: true},
            {name: 'has_image', type: 'integer', sqlType: 'integer', notNull: true, default: sqlValue(0)},
            {name: 'bundle_bytes', type: 'integer', sqlType: 'integer', notNull: true},
            {name: 'files_count', type: 'integer', sqlType: 'integer', notNull: true, default: sqlValue(0)},
            {name: 'files_bytes', type: 'integer', sqlType: 'integer', notNull: true, default: sqlValue(0)},
            {name: 'status', type: 'text', sqlType: 'text', notNull: true, default: sqlValue('new')}, // new | in_progress | waiting_reporter | closed | spam
            {name: 'status_by', type: 'text', sqlType: 'text'},
            {name: 'status_at', type: 'text', sqlType: 'text'},
            {name: 'note', type: 'text', sqlType: 'text'},
            {name: 'discord_state', type: 'text', sqlType: 'text'}, // sent | failed | off
            {name: 'deleted_at', type: 'text', sqlType: 'text'},
            {name: 'deleted_by', type: 'text', sqlType: 'text'},
        ],
        indexes: [
            {fields: ['key'], unique: true},
            {fields: ['project_id', 'client_key'], unique: true},
            {fields: ['project_id', 'created_at']},
            {fields: ['project_id', 'status', 'created_at']},
            {fields: ['rate_key', 'created_at']},
            {fields: ['created_at']},
        ],
        extensions: [{
            name: 'rules',
            listRule: null,
            viewRule: null,
            createRule: null,
            updateRule: null,
            deleteRule: null,
        } as TableRulesExtensionData],
    }, {
        name: 'report_files',
        autoSetUid: true,
        fields: [
            baseFields[0],
            {name: 'report_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'reports', column: 'id'}},
            {name: 'idx', type: 'integer', sqlType: 'integer', notNull: true}, // 0-based, the order they were attached
            {name: 'name', type: 'text', sqlType: 'text'}, // as sent; NULL after a delete
            {name: 'size', type: 'integer', sqlType: 'integer', notNull: true},
            {name: 'state', type: 'text', sqlType: 'text', notNull: true}, // done | deleted
        ],
        indexes: [{fields: ['report_id', 'idx'], unique: true}],
        extensions: [{
            name: 'rules',
            listRule: null,
            viewRule: null,
            createRule: null,
            updateRule: null,
            deleteRule: null,
        } as TableRulesExtensionData],
    }, {
        // The catalog of sample assets (models, HDRIs, textures): public to read through teenybase's table API (select,
        // list, view), written only with the admin token (scripts/sample-assets). Only for finding them, one query per
        // request: the files are read from their URLs with no database. A URL is on our samples bucket
        // (assets/<set_name>/<name>/) or anywhere else.
        name: 'threepipe_assets',
        autoSetUid: true,
        fields: [
            ...baseFields,
            {name: 'kind', type: 'text', sqlType: 'text', notNull: true}, // model | hdri | material | texture | scene (a composed world or diorama, often built by code)
            {name: 'set_name', type: 'text', sqlType: 'text', notNull: true}, // khronos, gltf-research-scenes, poly-haven, ...
            {name: 'name', type: 'text', sqlType: 'text', notNull: true}, // a slug, the source's name is in `label`
            {name: 'label', type: 'text', sqlType: 'text', notNull: true},
            {name: 'tags', type: 'text', sqlType: 'text'}, // JSON array, filter with json_contains(tags, '<tag>'). How `url` loads, when it is not a
            // file: `page` (a live page, e.g. a scene built by code at load time) or `recipe` (a JSON recipe, see metadata.recipe).
            // `procedural`: generated by code; the parts and settings to make it again are in metadata.recipe
            // where it comes from and what it may be used for (CC BY asks for a visible credit)
            {name: 'license', type: 'text', sqlType: 'text'}, // SPDX, like `CC-BY-4.0`; empty: not known
            {name: 'authors', type: 'text', sqlType: 'text'},
            {name: 'source_url', type: 'text', sqlType: 'text'}, // empty: not known
            // full URLs, ours or external; a thumbnail or a video may not exist yet
            {name: 'url', type: 'text', sqlType: 'text', notNull: true}, // the default file to load (a page or a recipe with the tags above)
            {name: 'thumb_url', type: 'text', sqlType: 'text'},
            {name: 'video_url', type: 'text', sqlType: 'text'},
            // measured from the default file, to filter and sort on; empty when it does not apply or until it is measured
            {name: 'size', type: 'integer', sqlType: 'integer'}, // bytes
            {name: 'triangles', type: 'integer', sqlType: 'integer'},
            {name: 'poly', type: 'text', sqlType: 'text'}, // low | mid | high, from `triangles`
            // JSON object, everything else: links [{label, url}], changes, screenshots [{label, url}], variants [{name, url, ...}],
            // views, animations, play, vertices, meshes, materials, textures, extensions, width, height. A list leaves it out of its `select`.
            // Scenes and procedural assets add: recipe {generator (the plugin, kit or script that builds it), version, params, seed},
            // views [{name, position, target, fov}], times [{name, ...}] (named lighting presets such as times of day), requires
            // (plugin types it needs, e.g. SSGIPlugin), page_url (the live page, when `url` is a file or a recipe), code_url (its
            // source), frame_ms {value, size, gpu} (a measured frame time). Its parts are rows too, linked below.
            {name: 'metadata', type: 'text', sqlType: 'text'},
        ],
        indexes: [
            {fields: ['set_name', 'name'], unique: true}, // a few hundred rows: no other index is worth its writes
        ],
        triggers: [createdTrigger, updatedTrigger],
        extensions: [{
            name: 'rules',
            listRule: 'true',
            viewRule: 'true',
            createRule: null,
            updateRule: null,
            deleteRule: null,
        } as TableRulesExtensionData],
    }, {
        // Links between sample assets, one row per link, read in both directions: a model `uses` a texture or an HDRI, an
        // optimized file is `optimized_from` its original, a texture is `part_of` a material. Sizes and formats of one file
        // are `variants` of its row instead. A scene `uses` each model, HDRI and texture it loads (their licences and credits
        // add up to the scene's), is `generated_by` the generator or kit row that builds it, and a remix or a seed variant is
        // `derived_from` the asset it starts from. An asset is named `<set_name>/<name>`. Public to read, admin token to write.
        name: 'threepipe_asset_links',
        autoSetUid: true,
        fields: [
            ...baseFields,
            {name: 'from_asset', type: 'text', sqlType: 'text', notNull: true},
            {name: 'relation', type: 'text', sqlType: 'text', notNull: true},
            {name: 'to_asset', type: 'text', sqlType: 'text', notNull: true},
        ],
        indexes: [
            {fields: ['from_asset', 'relation', 'to_asset'], unique: true},
            {fields: ['to_asset', 'relation']},
        ],
        triggers: [createdTrigger, updatedTrigger],
        extensions: [{
            name: 'rules',
            listRule: 'true',
            viewRule: 'true',
            createRule: null,
            updateRule: null,
            deleteRule: null,
        } as TableRulesExtensionData],
    }],
} satisfies DatabaseSettings

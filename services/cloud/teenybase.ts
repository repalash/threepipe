import {DatabaseSettings, TableAuthExtensionData, TableRulesExtensionData} from 'teenybase'
import {baseFields, authFields, createdTrigger, updatedTrigger} from 'teenybase/scaffolds/fields'
import {sqlValue} from 'teenybase'

// The username is the handle: the user's drive is `d/<username>/`, so it is picked once and never changes.
const userFields = authFields.map(f => f.name === 'username' ? {...f, noUpdate: true} : f)

/**
 * threepipe cloud: users (GitHub sign-in), access links for agents and scripts, and the registry of uploaded files.
 * The files themselves are in R2 and served without a database read (src/files.ts); the routes that write them are in src/uploads.ts.
 * `role` is 'member' (default), 'staff' or 'admin', set by an admin. `username` is the handle (account prefix).
 * `users.meta` is writable by the user and goes into their session JWT: only use JWT meta to restrict a token, never to grant.
 */
export default {
    appName: 'threepipe cloud',
    appUrl: '$APP_URL',
    jwtSecret: '$JWT_SECRET',
    authCookie: {name: 'tp_cloud_auth'}, // host-only on cloud.threepipe.org, never on the parent domain
    authProviders: [
        {name: 'github', clientId: '$GITHUB_CLIENT_ID', clientSecret: '$GITHUB_CLIENT_SECRET'},
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
        // Registry of every uploaded file, written by src/uploads.ts, never read when a file is served.
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
            {name: 'expires_at', type: 'text', sqlType: 'text'},
            // drive (d/) only: the item the file belongs to
            {name: 'item_id', type: 'text', sqlType: 'text'},
            {name: 'deleted_at', type: 'text', sqlType: 'text'},
            {name: 'deleted_by', type: 'text', sqlType: 'text'},
            {name: 'deleted_reason', type: 'text', sqlType: 'text'},
        ],
        indexes: [
            {fields: ['bucket', 'path'], unique: true},
            {fields: ['owner_id', 'prefix']},
            {fields: 'item_id', where: {q: 'item_id IS NOT NULL'}},
            {fields: 'expires_at', where: {q: 'expires_at IS NOT NULL AND deleted_at IS NULL'}},
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
        // Who owns a scope (`s/<slug>`, `p/<name>`, `b/<repo>/<ref>`): claimed atomically by the first upload (the unique
        // index), released by the daily cron once the scope has no files left (src/uploads.ts, src/cron.ts).
        name: 'scopes',
        autoSetUid: true,
        fields: [
            ...baseFields,
            {name: 'scope', type: 'text', sqlType: 'text', notNull: true, unique: true},
            {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
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
            {name: 'size', type: 'integer', sqlType: 'integer', notNull: true, default: sqlValue(0)},
            {name: 'files_count', type: 'integer', sqlType: 'integer', notNull: true, default: sqlValue(0)},
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
        // Reports (src/reports.ts, from #104). The row holds what the list shows and what the caps count; the report
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
            {name: 'type', type: 'text', sqlType: 'text', notNull: true}, // bug | question | idea
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
    }],
} satisfies DatabaseSettings

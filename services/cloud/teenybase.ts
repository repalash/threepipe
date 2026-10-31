import {DatabaseSettings, TableAuthExtensionData, TableRulesExtensionData} from 'teenybase'
import {baseFields, authFields, createdTrigger, updatedTrigger} from 'teenybase/scaffolds/fields'

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
            // drive (d/) only: private, link, public
            {name: 'visibility', type: 'text', sqlType: 'text'},
            {name: 'deleted_at', type: 'text', sqlType: 'text'},
            {name: 'deleted_by', type: 'text', sqlType: 'text'},
            {name: 'deleted_reason', type: 'text', sqlType: 'text'},
        ],
        indexes: [
            {fields: ['bucket', 'path'], unique: true},
            {fields: ['owner_id', 'prefix']},
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
        // Share links to drive files and folders: files…/f/<id>/… Served from a pointer object `f/<id>` in R2 (no
        // database read); this table is for listing. Created and deleted by /api/v1/drive-links (src/drive.ts).
        name: 'drive_links',
        autoSetUid: true,
        fields: [
            ...baseFields,
            {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
            {name: 'path', type: 'text', sqlType: 'text', notNull: true},
        ],
        indexes: [{fields: ['owner_id']}],
        triggers: [createdTrigger, updatedTrigger],
        extensions: [{
            name: 'rules',
            listRule: 'auth.uid == owner_id',
            viewRule: 'auth.uid == owner_id',
            createRule: null,
            updateRule: null,
            deleteRule: null,
        } as TableRulesExtensionData],
    }],
} satisfies DatabaseSettings

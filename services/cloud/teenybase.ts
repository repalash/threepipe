import {DatabaseSettings, TableAuthExtensionData, TableRulesExtensionData} from 'teenybase'
import {baseFields, authFields, createdTrigger, updatedTrigger} from 'teenybase/scaffolds/fields'

/**
 * threepipe cloud: users (GitHub sign-in), access links for agents and scripts, and the registry of uploaded files.
 * The files themselves are in R2 and served without a database read (src/files.ts); the routes that write them are in src/uploads.ts.
 * `role` is 'member' (default), 'staff' or 'admin', set by an admin. `username` is the handle (account prefix).
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
        fields: [...baseFields, ...authFields],
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
        // One per agent/machine. The code is only in the link the user copies; this table keeps its hash.
        // Created by POST /api/v1/access-links (src/access.ts); the owner lists and deletes (revokes) them here.
        name: 'access_links',
        autoSetUid: true,
        fields: [
            ...baseFields,
            {name: 'owner_id', type: 'relation', sqlType: 'text', notNull: true, foreignKey: {table: 'users', column: 'id'}},
            {name: 'name', type: 'text', sqlType: 'text'},
            {name: 'code_hash', type: 'text', sqlType: 'text', notNull: true, unique: true, noSelect: true},
            {name: 'last_used', type: 'text', sqlType: 'text'},
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
    }],
} satisfies DatabaseSettings

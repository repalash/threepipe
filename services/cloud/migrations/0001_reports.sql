-- Copied from ijewel-mono services/ops-worker/crm-migrations/0010_support_reports.sql @ 54d43285 (IJ-564), simplified
-- for threepipe: guests only (Turnstile), files sent with the report in one request, no account columns, no grouping.
--
-- Reports that people send from threepipe apps (src/reports.ts).
--
-- The rows hold what the staff list shows and what the caps count. The report itself (the user's
-- text, the log, the environment, the context) is one JSON document in R2 (BUCKET,
-- reports/<key>/report.json), the screenshot beside it, and each attached file under
-- reports/<key>/files/<index>-<file name>. R2 keys use `key`, never the public id: the id is printed
-- on the Discord card and pasted by users, so it must not name an object.
--
-- Nothing deletes a row. A staff delete removes the R2 objects and clears the personal columns; the
-- row stays as a tombstone (id, dates, who deleted it).
CREATE TABLE IF NOT EXISTS reports (
    id                TEXT PRIMARY KEY,          -- public id, 'R-' + 6 Crockford base32 characters
    key               TEXT NOT NULL UNIQUE,      -- random uuid; the R2 keys use it
    client_key        TEXT NOT NULL UNIQUE,      -- the dialog's Idempotency-Key: a repeated key returns this row
    created_at        TEXT NOT NULL,             -- ISO 8601 UTC
    env               TEXT NOT NULL,             -- 'prod' | 'staging' | 'dev' | 'local' | 'other', from the Origin header
    type              TEXT NOT NULL,             -- 'bug' | 'question' | 'idea'
    surface           TEXT NOT NULL,             -- where the dialog opened: 'modelling-editor', 'examples', …
    email             TEXT,                      -- as typed, NOT verified; NULL when none was given
    rate_key          TEXT NOT NULL,             -- keyed hash of the sender (the IP, its /64 for IPv6); the daily caps count it
    summary           TEXT,                      -- the first 200 characters of the user's text, for the list
    cause             TEXT,                      -- the cause the client named ('error', 'unhandled-rejection', 'context-lost', 'operation', …)
    versions_json     TEXT NOT NULL,             -- {threepipe, app, plugin-…}: validated short strings
    has_image         INTEGER NOT NULL DEFAULT 0,
    bundle_bytes      INTEGER NOT NULL,          -- size of report.json
    files_count       INTEGER NOT NULL DEFAULT 0,
    files_bytes       INTEGER NOT NULL DEFAULT 0,-- the daily file budget counts these
    status            TEXT NOT NULL DEFAULT 'new', -- 'new' | 'in_progress' | 'waiting_reporter' | 'closed' | 'spam'
    status_by         TEXT,                      -- the staff name of the last status change
    status_at         TEXT,
    note              TEXT,                      -- a staff note
    discord_state     TEXT,                      -- 'sent' | 'failed' | 'off' (no webhook configured)
    deleted_at        TEXT,                      -- set by a staff delete
    deleted_by        TEXT
);
CREATE INDEX IF NOT EXISTS reports_created ON reports (created_at);
CREATE INDEX IF NOT EXISTS reports_rate ON reports (rate_key, created_at);
CREATE INDEX IF NOT EXISTS reports_status ON reports (status, created_at);
CREATE INDEX IF NOT EXISTS reports_email ON reports (email);

-- The files a person attached to a report: the scene as .glb, the modelling command transcript.
CREATE TABLE IF NOT EXISTS report_files (
    report_id   TEXT NOT NULL REFERENCES reports (id),
    idx         INTEGER NOT NULL,                -- 0-based, the order they were attached
    name        TEXT,                            -- the file name as sent; NULL after a delete
    size        INTEGER NOT NULL,
    state       TEXT NOT NULL,                   -- 'done' | 'deleted'
    PRIMARY KEY (report_id, idx)
);

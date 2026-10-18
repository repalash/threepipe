/**
 * The bindings and vars of threepipe-cloud (wrangler.toml). Secrets are set with
 * `wrangler secret put`; anything optional is off while unset.
 */
export interface Env {
    /** reports, report_files (migrations/). */
    DB: D1Database
    /** One private bucket: shares under <slug>/, write-once assets under .a/, reports under reports/. */
    BUCKET: R2Bucket

    /** 'https://threepipe.org=prod,https://dev.threepipe.org=dev,…': the pages that may send a report or
     *  upload a share from a browser, with the env tag their reports get. Local origins (localhost,
     *  *.localhost, 127.0.0.1) are always allowed, as 'local'. */
    ORIGINS?: string
    /** Where a browser visit to the workers.dev name is sent (the custom domain). Unset: none. */
    CANONICAL_HOST?: string

    /** Secret: the Turnstile widget's secret key. Cloudflare's documented test secrets answer offline (src/lib/turnstile.ts). */
    TURNSTILE_SECRET?: string
    /** The hostnames a Turnstile pass may come from (siteverify `hostname`). Empty: any. */
    TURNSTILE_HOSTNAMES?: string
    /** The daily caps (last 24 hours): reports per sender, reports in total, attached bytes in total. */
    REPORTS_DAILY_CAP?: string
    REPORTS_DAILY_CAP_ALL?: string
    REPORTS_DAILY_FILE_BYTES_ALL?: string
    /** Secret: a Discord webhook URL (or its `id/token` path) for the report card. Unset: no card. */
    DISCORD_WEBHOOK?: string
    /** On the card: where staff open a report (this worker's /staff page). */
    STAFF_URL?: string

    /** Secret: 'name=token,name2=token2' for /staff. The name is the actor of a change. */
    STAFF_TOKENS?: string
    /** Secret: 'name=token,…' for POST /share. The name is the share's owner. */
    SHARE_TOKENS?: string
}

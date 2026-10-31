/**
 * Every limit of threepipe cloud, in one place. They are constants in the code (a change is a deploy), except the
 * daily report caps, which are wrangler vars (REPORTS_DAILY_*, wrangler.jsonc) so they can be raised without a code
 * change; the values here are their defaults. agents.md (src/access.ts) and the README quote these.
 * An admin can give one user other limits in the user_limits table (teenybase.ts): see {@link UserLimits}.
 */

const MB = 1024 * 1024
const GB = 1024 * MB
const HOUR = 60 * 60
const DAY = 24 * HOUR

// ---- uploads (src/uploads.ts, src/drive.ts, src/buckets.ts) ----
/** One file per request, streamed through the Worker. A folder is one PUT per file. */
export const UPLOAD_MAX_BYTES = 90 * MB
/** s/ shares: days kept by default, and the most `?ttl=` may ask for. */
export const SHARE_DEFAULT_DAYS = 7
export const SHARE_MAX_DAYS = 30
/** b/ builds: kept this many days after the last upload to the build. */
export const BUILD_DAYS = 30
/** POST /api/v1/buckets/<bucket>/missing: paths per call. */
export const MISSING_PATHS_MAX = 500

// ---- keys (src/access.ts, src/connect.ts) ----
/** An access key of an agent (from its access link); the link gives a new one. */
export const ACCESS_KEY_SECONDS = 30 * DAY
/** An app key (Sign in with threepipe); the app asks again, silently once approved. */
export const APP_KEY_SECONDS = DAY

// ---- drive (src/drive.ts) ----
/** The sum of a user's drive files, per role. */
export const DRIVE_QUOTA: Record<'member' | 'staff' | 'admin', number> = {member: 1 * GB, staff: 50 * GB, admin: 50 * GB}
/** Signed URLs of private items: the default and the longest. */
export const SIGN_DEFAULT_SECONDS = HOUR
export const SIGN_MAX_SECONDS = 7 * DAY
/** Changing an item's visibility or id rewrites each of its files (R2 has no metadata update or rename). */
export const ITEM_REWRITE_FILES_MAX = 500
/** Folders and items listed per folder. */
export const DRIVE_LIST_MAX = 1000
/** Folder depth followed when resolving a path. */
export const FOLDER_DEPTH_MAX = 64

// ---- projects and reports (src/projects.ts, src/reports.ts) ----
/** Projects a member owns (staff: no limit). */
export const PROJECTS_MAX = 5
/** The report JSON, with the screenshot inline as a data URL. */
export const REPORT_MAX = 5 * MB
/** Files sent with a report (multipart/form-data), and their bytes together. */
export const REPORT_FILES_MAX = 3
export const REPORT_FILES_BYTES_MAX = 10 * MB
/** The whole request: the report and the files, with room for the multipart framing. */
export const REPORT_BODY_MAX = REPORT_MAX + REPORT_FILES_BYTES_MAX + 64 * 1024
export const REPORT_IMAGE_MAX = 3 * MB
export const REPORT_TEXT_MAX = 10_000
export const REPORT_LOG_LINES_MAX = 500
export const REPORT_LOG_LINE_MAX = 1000
export const REPORT_ENVIRONMENT_MAX = 8 * 1024
export const REPORT_CONTEXT_MAX = 16 * 1024
export const REPORT_VERSIONS_MAX = 24
export const REPORT_NOTE_MAX = 2000
/** Reports listed per page. */
export const REPORTS_LIST_MAX = 200
/** Over the last 24 hours; each can be set with its wrangler var. */
export const REPORTS_DAILY = {
    /** reports per sender (user, or a hash of the IP address) */
    perSender: {variable: 'REPORTS_DAILY_CAP', default: 20},
    /** reports per project */
    perProject: {variable: 'REPORTS_DAILY_CAP_PROJECT', default: 300},
    /** all reports */
    all: {variable: 'REPORTS_DAILY_CAP_ALL', default: 1000},
    /** bytes of attached files, all reports */
    fileBytes: {variable: 'REPORTS_DAILY_FILE_BYTES_ALL', default: 2 * GB},
} as const

/** A daily report cap: its wrangler var when that is a positive integer, else the default. */
export function dailyCap(env: CloudflareBindings, cap: keyof typeof REPORTS_DAILY): number {
    const n = parseInt(String(env[REPORTS_DAILY[cap].variable] ?? ''), 10)
    return Number.isInteger(n) && n > 0 ? n : REPORTS_DAILY[cap].default
}

// ---- per user ----
/** A user's row of user_limits (set by an admin): each one set replaces the role's limit. */
export interface UserLimits {
    /** bytes, instead of DRIVE_QUOTA */
    drive_quota?: number
    /** projects they may own, instead of PROJECTS_MAX (or no limit for staff) */
    projects?: number
    /** reports they may send in 24 hours, instead of the per-sender cap */
    reports_daily?: number
}
interface LimitedUser {role: keyof typeof DRIVE_QUOTA, limits: UserLimits}

export const driveQuota = (u: LimitedUser) => u.limits.drive_quota ?? DRIVE_QUOTA[u.role]
export const projectsMax = (u: LimitedUser) => u.limits.projects ?? (u.role === 'member' ? PROJECTS_MAX : Infinity)
export const reportsDaily = (env: CloudflareBindings, u: LimitedUser) => u.limits.reports_daily ?? dailyCap(env, 'perSender')

/** `90 MB`, `1 GB`: a limit in bytes for messages. */
export const sizeText = (bytes: number) => bytes >= GB ? `${+(bytes / GB).toFixed(2)} GB` : `${Math.round(bytes / MB)} MB`

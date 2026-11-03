/**
 * Every limit of threepipe cloud, in one place: constants in the code (a change is a deploy). agents.md (src/access.ts)
 * and the README quote these.
 * An admin can give one user other limits in the user_limits table (teenybase.ts): see {@link UserLimits}.
 */

const MB = 1024 * 1024
const GB = 1024 * MB
const HOUR = 60 * 60
/** Seconds in a day. */
export const DAY = 24 * HOUR

// ---- uploads (src/uploads.ts, src/drive.ts, src/buckets.ts) ----
/** One file per PUT, streamed through the Worker. */
export const UPLOAD_MAX_BYTES = 90 * MB
/** Many files per POST (multipart, read into the Worker's memory, 128 MB): bytes and files per request. */
export const UPLOAD_BATCH_BYTES = 40 * MB
export const UPLOAD_BATCH_FILES = 500
/** A .md file bigger than this is served as it is, not rendered (the worker's CPU time). */
export const MARKDOWN_RENDER_BYTES = 2 * 1024 * 1024
/** s/ shares: days kept by default, and the most `?ttl=` may ask for. */
export const SHARE_DEFAULT_DAYS = 7
export const SHARE_MAX_DAYS = 30
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
/** Files of an item a share or unshare rewrites in one request (R2 has no metadata update; Workers limit subrequests). */
export const VISIBILITY_FILES_MAX = 500
/** `name (2)` … `name (99)`: the free names tried for a new folder or item. */
export const NAME_COPIES_MAX = 100
/** Folders and items listed per folder. */
export const DRIVE_LIST_MAX = 1000
/** Folder depth followed when resolving a path. */
export const FOLDER_DEPTH_MAX = 64

/** Names people give a project or an access link: characters kept. */
export const LABEL_MAX = 100

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
/** Reports over the last 24 hours. */
export const REPORTS_DAILY = {
    /** per sender (user, or a hash of the IP address) */
    perSender: 100,
    perProject: 10000,
    all: 50000,
    /** bytes of attached files, all reports */
    fileBytes: 20 * GB,
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
export const reportsDaily = (u: LimitedUser) => u.limits.reports_daily ?? REPORTS_DAILY.perSender

/** `90 MB`, `1 GB`: a limit in bytes for messages. */
export const sizeText = (bytes: number) => bytes >= GB ? `${+(bytes / GB).toFixed(2)} GB` : `${Math.round(bytes / MB)} MB`

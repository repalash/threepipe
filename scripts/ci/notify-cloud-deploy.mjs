/**
 * The notice of a threepipe cloud deploy (.github/workflows/deploy-cloud.yml), as repalash/release-tools does for npm:
 * 1. Starts the Claude Code review routine (when the check passed, on a push by REVIEW_ACTOR, with the routine set up).
 * 2. Posts to Discord: the approval link, the review session, the commits since the last deploy; or that it failed.
 * `--failed`: the deploy after the approval failed (only the Discord notice).
 *
 * Env: BUILD_OK, BEFORE (the commit deployed before), REVIEW_ACTOR, DISCORD_WEBHOOK_URL, CLAUDE_REVIEW_FIRE_URL,
 * CLAUDE_REVIEW_TOKEN, and the GitHub Actions defaults. Without the secrets it does nothing (and does not fail).
 */
import {execFileSync} from 'node:child_process'

const env = process.env
const repository = env.GITHUB_REPOSITORY
const sha = env.GITHUB_SHA
const runUrl = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repository}/actions/runs/${env.GITHUB_RUN_ID}`
const failedDeploy = process.argv.includes('--failed')

/** `<hash> <subject>` of the commits to services/cloud since the last deploy (the last 20 when that is unknown). */
function commits() {
    const before = env.BEFORE && !/^0+$/.test(env.BEFORE) ? env.BEFORE : ''
    const range = before ? [`${before}..${sha}`] : ['-20', sha]
    try {
        return execFileSync('git', ['log', '--format=%h %s', ...range, '--', 'services/cloud'], {encoding: 'utf8'}).trim().split('\n').filter(Boolean)
    } catch {
        return []
    }
}

async function review(list) {
    const ok = env.BUILD_OK === 'true' && env.GITHUB_EVENT_NAME === 'push' && env.REVIEW_ACTOR && env.GITHUB_ACTOR === env.REVIEW_ACTOR
    if (!ok || !env.CLAUDE_REVIEW_FIRE_URL || !env.CLAUDE_REVIEW_TOKEN) {
        console.log('Claude review skipped (check failed, not a push by the review actor, or no routine set up).')
        return ''
    }
    const text = [
        'threepipe cloud deploy review',
        `repository: ${repository}`,
        `commit: ${sha}`,
        `deployed before: ${env.BEFORE || 'unknown'}`,
        `run (approval pending): ${runUrl}`,
        'what deploys: services/cloud (a Cloudflare Worker with D1 and R2) to cloud.threepipe.org and files.threepipe.org;',
        'teenybase applies the database migrations that teenybase.ts changes. Read services/cloud/AGENTS.md first.',
        'commits to services/cloud since the last deploy:',
        ...list.length ? list.map(c => `- ${c}`) : ['- none'],
    ].join('\n') + '\n'
    try {
        const res = await fetch(env.CLAUDE_REVIEW_FIRE_URL, {
            method: 'POST',
            headers: {
                'authorization': `Bearer ${env.CLAUDE_REVIEW_TOKEN}`,
                'anthropic-beta': 'experimental-cc-routine-2026-04-01',
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            body: JSON.stringify({text}),
        })
        const body = await res.json().catch(() => ({}))
        if (res.ok && body.claude_code_session_url) return body.claude_code_session_url
        console.log(`Claude review request failed: HTTP ${res.status} ${JSON.stringify(body.error ?? body).slice(0, 300)}`)
    } catch (e) {
        console.log(`Claude review request failed: ${e.message}`)
    }
    return ''
}

async function discord(lines) {
    if (!env.DISCORD_WEBHOOK_URL) return console.log('DISCORD_WEBHOOK_URL not set, no notice.')
    let content = lines.join('\n')
    if (content.length > 2000) content = content.slice(0, 1990) + '\n…'
    const res = await fetch(env.DISCORD_WEBHOOK_URL, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({content})})
    if (!res.ok) console.log(`Discord notice failed: HTTP ${res.status}`)
}

const short = sha.slice(0, 7)
if (failedDeploy) {
    await discord([`❌ ${repository}: the threepipe cloud deploy of \`${short}\` failed after the approval.`, `Log: ${runUrl}`])
} else if (env.BUILD_OK !== 'true') {
    await discord([`❌ ${repository}: the check of the threepipe cloud deploy \`${short}\` failed; nothing is deployed.`, `Log: ${runUrl}`])
} else {
    const list = commits()
    const session = await review(list)
    await discord([
        `☁️ ${repository}: threepipe cloud \`${short}\` is checked and waits for approval to deploy.`,
        `Approve: ${runUrl}`,
        ...session ? [`🤖 Claude review: ${session}`] : [],
        ...list.length ? ['', ...list.map(c => `- \`${c.slice(0, c.indexOf(' '))}\` ${c.slice(c.indexOf(' ') + 1)}`)] : [],
    ])
}

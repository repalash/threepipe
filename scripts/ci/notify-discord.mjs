/**
 * Sends a Discord webhook notification with build/verification results.
 * Expects environment variables:
 *   DISCORD_WEBHOOK_URL - Discord webhook URL
 *   PASSED_PACKAGES - JSON array of packages that passed verification
 *   FAILED_PACKAGES - JSON array of packages that failed (with error field)
 *   GITHUB_RUN_ID - GitHub Actions run ID
 *   GITHUB_REPOSITORY - GitHub repository (owner/repo)
 *   GITHUB_SERVER_URL - GitHub server URL
 */

const passed = JSON.parse(process.env.PASSED_PACKAGES || '[]');
const failed = JSON.parse(process.env.FAILED_PACKAGES || '[]');
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const runId = process.env.GITHUB_RUN_ID;
const repo = process.env.GITHUB_REPOSITORY;
const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';

if (!webhookUrl) {
    console.log('DISCORD_WEBHOOK_URL not set, skipping notification.');
    process.exit(0);
}

if (passed.length === 0 && failed.length === 0) {
    console.log('No packages to notify about.');
    process.exit(0);
}

const approveUrl = `${serverUrl}/${repo}/actions/runs/${runId}`;

async function send(body) {
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        console.error(`Discord webhook failed: ${response.status} ${response.statusText}`);
        process.exit(1);
    }
}

function truncate(text, limit = 2000) {
    if (text.length <= limit) return text;
    return text.slice(0, limit - 10) + '\n...';
}

function formatCommits(commits) {
    if (!commits) return null;
    return commits.split('\n').map(line => {
        const spaceIdx = line.indexOf(' ');
        if (spaceIdx === -1) return `- ${line}`;
        const hash = line.slice(0, spaceIdx);
        const msg = line.slice(spaceIdx + 1);
        return `- \`${hash}\` ${msg}`;
    }).join('\n');
}

const allFailed = passed.length === 0;

// 1. Send failures (if any)
if (failed.length > 0) {
    const failLines = failed.map(c => `- \`${c.name}@${c.to}\` — ${c.error}`);
    const msg = `## Failed\n${failLines.join('\n')}`;
    await send({content: truncate(msg)});
}

// 2. Send changelog for passed packages
if (passed.length > 0) {
    const changelogSections = passed
        .filter(c => c.changelog)
        .map(c => `### ${c.name}@${c.to}\n${c.changelog}`);

    if (changelogSections.length > 0) {
        const msg = `## Changelog\n${changelogSections.join('\n\n')}`;
        await send({content: truncate(msg)});
    }

    // 3. Send commits for passed packages
    const commitSections = passed
        .filter(c => c.commits)
        .map(c => `### ${c.name}\n${formatCommits(c.commits)}`);

    if (commitSections.length > 0) {
        const msg = `## Commits\n${commitSections.join('\n\n')}`;
        await send({content: truncate(msg)});
    }
}

// 4. Send summary embed at the end
if (allFailed) {
    const failLines = failed.map(c => `- \`${c.name}\` ${c.from ?? '(new)'} → ${c.to}`);
    await send({
        embeds: [{
            title: 'threepipe — All packages failed verification',
            description: failLines.join('\n') + `\n\n[View details](${approveUrl})`,
            color: 0xED4245,
        }],
    });
} else {
    const passLines = passed.map(c => `- \`${c.name}\` ${c.from ?? '(new)'} → ${c.to}`);
    let description = passLines.join('\n');

    if (failed.length > 0) {
        const failNames = failed.map(c => `\`${c.name}\``).join(', ');
        description += `\n\n⚠ Failed: ${failNames}`;
    }

    description += `\n\n[Approve publish](${approveUrl})`;

    await send({
        embeds: [{
            title: 'threepipe — Packages ready to publish',
            description,
            color: failed.length > 0 ? 0xFEE75C : 0x5865F2,
        }],
    });
}

console.log('Discord notification sent.');

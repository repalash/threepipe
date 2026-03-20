/**
 * Sends a Discord webhook notification with the list of packages to publish,
 * including changelog entries and recent commits.
 * Expects environment variables:
 *   DISCORD_WEBHOOK_URL - Discord webhook URL
 *   PUBLISH_CHANGES - JSON array of {name, from, to, changelog, commits}
 *   GITHUB_RUN_ID - GitHub Actions run ID
 *   GITHUB_REPOSITORY - GitHub repository (owner/repo)
 *   GITHUB_SERVER_URL - GitHub server URL
 */

const changes = JSON.parse(process.env.PUBLISH_CHANGES || '[]');
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const runId = process.env.GITHUB_RUN_ID;
const repo = process.env.GITHUB_REPOSITORY;
const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';

if (!webhookUrl) {
    console.log('DISCORD_WEBHOOK_URL not set, skipping notification.');
    process.exit(0);
}

if (changes.length === 0) {
    console.log('No changes to notify about.');
    process.exit(0);
}

const approveUrl = `${serverUrl}/${repo}/actions/runs/${runId}`;

// Build package list
const packageLines = changes.map(c => `- \`${c.name}\` ${c.from ?? '(new)'} → ${c.to}`);

// Build changelog section
const changelogSections = changes
    .filter(c => c.changelog)
    .map(c => `**${c.name}@${c.to}**\n${c.changelog}`);

// Build commits section
const commitSections = changes
    .filter(c => c.commits)
    .map(c => `**${c.name}**\n${c.commits}`);

// Discord embed description has a 4096 char limit
let description = packageLines.join('\n');

if (changelogSections.length > 0) {
    description += `\n\n**Changelog**\n${changelogSections.join('\n\n')}`;
}

if (commitSections.length > 0) {
    description += `\n\n**Commits**\n${commitSections.join('\n\n')}`;
}

description += `\n\n[Approve publish](${approveUrl})`;

// Truncate if too long for Discord embed
if (description.length > 4000) {
    description = description.slice(0, 3950) + `\n...\n\n[Approve publish](${approveUrl})`;
}

const body = {
    embeds: [{
        title: 'threepipe — Packages ready to publish',
        description,
        color: 0x5865F2,
    }],
};

const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
});

if (!response.ok) {
    console.error(`Discord webhook failed: ${response.status} ${response.statusText}`);
    process.exit(1);
}

console.log('Discord notification sent.');

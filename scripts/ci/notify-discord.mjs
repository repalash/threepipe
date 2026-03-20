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

let message = `## threepipe — Packages ready to publish\n${packageLines.join('\n')}`;

// Build changelog sections
const changelogSections = changes
    .filter(c => c.changelog)
    .map(c => `### ${c.name}@${c.to}\n${c.changelog}`);

if (changelogSections.length > 0) {
    message += `\n\n## Changelog\n${changelogSections.join('\n\n')}`;
}

// Build commits sections
const commitSections = changes
    .filter(c => c.commits)
    .map(c => `### ${c.name}\n${c.commits}`);

if (commitSections.length > 0) {
    message += `\n\n## Commits\n${commitSections.join('\n\n')}`;
}

message += `\n\n**[Approve publish](${approveUrl})**`;

// Discord message content has a 2000 char limit, use multiple messages if needed
const messages = [];
if (message.length <= 2000) {
    messages.push(message);
} else {
    // Split: first message has packages + changelog, second has commits + approve link
    let first = `## threepipe — Packages ready to publish\n${packageLines.join('\n')}`;
    if (changelogSections.length > 0) {
        first += `\n\n## Changelog\n${changelogSections.join('\n\n')}`;
    }
    // Truncate first message if still too long
    if (first.length > 2000) {
        first = first.slice(0, 1950) + '\n...';
    }
    messages.push(first);

    let second = '';
    if (commitSections.length > 0) {
        second = `## Commits\n${commitSections.join('\n\n')}`;
    }
    second += `\n\n**[Approve publish](${approveUrl})**`;
    if (second.length > 2000) {
        second = second.slice(0, 1950) + `\n...\n\n**[Approve publish](${approveUrl})**`;
    }
    messages.push(second);
}

for (const msg of messages) {
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({content: msg}),
    });

    if (!response.ok) {
        console.error(`Discord webhook failed: ${response.status} ${response.statusText}`);
        process.exit(1);
    }
}

console.log('Discord notification sent.');

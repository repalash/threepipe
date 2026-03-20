import {loopPluginDirs} from '../utils.mjs';
import path from 'node:path';
import fs from 'node:fs';
import {execSync} from 'node:child_process';

/**
 * Compares local package version with the published npm version.
 * Returns a list of packages that need publishing.
 * Validates that each changed package has a changelog entry.
 */

function getPublishedVersion(packageName) {
    try {
        return execSync(`npm view ${packageName} version`, {encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim();
    } catch {
        // Package not found on npm (first publish)
        return null;
    }
}

function getChangelogEntry(dir, version) {
    const changelogPath = path.join(dir, 'CHANGELOG.md');
    if (!fs.existsSync(changelogPath)) return null;

    const content = fs.readFileSync(changelogPath, 'utf8');
    // Match ## [version] and capture everything until the next ## [
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = content.match(new RegExp(`## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`));
    if (!match) return null;

    return match[1].trim();
}

function getCommitsSince(publishedVersion, dir, packageName) {
    // Find the tag for the published version
    let tag = null;
    if (publishedVersion) {
        // Try core tag format (v0.4.4) and plugin tag format (@threepipe/plugin-name-0.10.1)
        const candidates = [
            `v${publishedVersion}`,
            `${packageName}-${publishedVersion}`,
        ];
        for (const candidate of candidates) {
            try {
                execSync(`git rev-parse ${candidate}`, {encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']});
                tag = candidate;
                break;
            } catch {
                // tag doesn't exist
            }
        }
    }

    try {
        const range = tag ? `${tag}..HEAD` : 'HEAD~20..HEAD';
        const pathFilter = dir === '.' ? '-- . ":!plugins"' : `-- ${dir}`;
        const log = execSync(`git log ${range} --oneline --no-merges ${pathFilter}`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        return log || null;
    } catch {
        return null;
    }
}

const changes = [];
const errors = [];

// Check core package
const rootDir = path.resolve(import.meta.dirname, '../..');
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const corePublished = getPublishedVersion(rootPkg.name);
if (corePublished !== rootPkg.version) {
    const changelog = getChangelogEntry(rootDir, rootPkg.version);
    if (!changelog) {
        errors.push(`${rootPkg.name}@${rootPkg.version}: missing changelog entry in CHANGELOG.md`);
    }
    const commits = getCommitsSince(corePublished, '.', rootPkg.name);
    changes.push({name: rootPkg.name, from: corePublished, to: rootPkg.version, dir: '.', changelog, commits});
}

// Check plugins
loopPluginDirs((pluginDir, pluginFolder) => {
    if (pluginFolder.startsWith('plugin-template-')) return;

    const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8'));
    if (pkg.private) return;

    const published = getPublishedVersion(pkg.name);
    if (published !== pkg.version) {
        const relDir = `plugins/${pluginFolder}`;
        const changelog = getChangelogEntry(pluginDir, pkg.version);
        if (!changelog) {
            errors.push(`${pkg.name}@${pkg.version}: missing changelog entry in ${relDir}/CHANGELOG.md`);
        }
        const commits = getCommitsSince(published, relDir, pkg.name);
        changes.push({name: pkg.name, from: published, to: pkg.version, dir: relDir, changelog, commits});
    }
});

if (changes.length === 0) {
    console.log('No packages need publishing.');
} else {
    console.log(`${changes.length} package(s) to publish:`);
    for (const c of changes) {
        console.log(`  ${c.name} ${c.from ?? '(new)'} → ${c.to}`);
    }
}

if (errors.length > 0) {
    console.error(`\nChangelog validation failed:`);
    for (const e of errors) {
        console.error(`  ✗ ${e}`);
    }
    process.exit(1);
}

// Output as JSON for CI consumption (use delimiter syntax for multiline values)
const outputFile = process.env.GITHUB_OUTPUT;
if (outputFile) {
    const delimiter = `EOF_${Date.now()}`;
    const json = JSON.stringify(changes);
    fs.appendFileSync(outputFile, `changes<<${delimiter}\n${json}\n${delimiter}\n`);
    fs.appendFileSync(outputFile, `has_changes=${changes.length > 0}\n`);
}

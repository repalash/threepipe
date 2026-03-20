import {loopPluginDirs} from '../utils.mjs';
import path from 'node:path';
import fs from 'node:fs';
import {execSync} from 'node:child_process';

/**
 * Compares local package version with the published npm version.
 * Returns a list of packages that need publishing.
 */

function getPublishedVersion(packageName) {
    try {
        return execSync(`npm view ${packageName} version`, {encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim();
    } catch {
        // Package not found on npm (first publish)
        return null;
    }
}

const changes = [];

// Check core package
const rootDir = path.resolve(import.meta.dirname, '../..');
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const corePublished = getPublishedVersion(rootPkg.name);
if (corePublished !== rootPkg.version) {
    changes.push({name: rootPkg.name, from: corePublished, to: rootPkg.version, dir: '.'});
}

// Check plugins
loopPluginDirs((pluginDir, pluginFolder) => {
    if (pluginFolder.startsWith('plugin-template-')) return;

    const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8'));
    if (pkg.private) return;

    const published = getPublishedVersion(pkg.name);
    if (published !== pkg.version) {
        changes.push({name: pkg.name, from: published, to: pkg.version, dir: `plugins/${pluginFolder}`});
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

// Output as JSON for CI consumption
const outputFile = process.env.GITHUB_OUTPUT;
if (outputFile) {
    fs.appendFileSync(outputFile, `changes=${JSON.stringify(changes)}\n`);
    fs.appendFileSync(outputFile, `has_changes=${changes.length > 0}\n`);
}

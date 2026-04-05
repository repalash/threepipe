import path from 'node:path';
import fs from 'node:fs';

/**
 * Verifies each changed package: changelog exists and build output exists.
 * Packages that fail are excluded from publishing.
 * Expects PUBLISH_CHANGES env var with JSON array of {name, from, to, dir, changelog, commits}.
 */

const changes = JSON.parse(process.env.PUBLISH_CHANGES || '[]');

if (changes.length === 0) {
    console.log('No packages to verify.');
    process.exit(0);
}

const repoRoot = path.resolve(import.meta.dirname, '../..');

/** Extract the tail of build.log (if it exists) */
function getBuildError() {
    const logPath = path.join(repoRoot, 'build.log');
    if (!fs.existsSync(logPath)) return '';
    try {
        const log = fs.readFileSync(logPath, 'utf-8');
        // Return last 1500 characters of the log
        const tail = log.slice(-1500).trim();
        return tail;
    } catch {
        return '';
    }
}

const passed = [];
const failed = [];

for (const pkg of changes) {
    const cwd = path.resolve(repoRoot, pkg.dir);
    console.log(`\nVerifying ${pkg.name}@${pkg.to}...`);
    try {
        // Check changelog entry exists
        if (!pkg.changelog) {
            throw new Error(`Missing changelog entry for ${pkg.to} in ${pkg.dir}/CHANGELOG.md`);
        }

        // Check build output exists
        const distDir = path.join(cwd, 'dist');
        if (!fs.existsSync(distDir)) {
            const buildError = getBuildError();
            const msg = buildError
                ? `dist/ directory does not exist. Build error:\n${buildError}`
                : 'dist/ directory does not exist (no build log found)';
            throw new Error(msg);
        }
        const files = fs.readdirSync(distDir);
        if (files.length === 0) {
            throw new Error('dist/ directory is empty');
        }
        const hasIndex = files.some(f => f.startsWith('index'));
        if (!hasIndex) {
            throw new Error(`dist/ missing index file, found: ${files.slice(0, 5).join(', ')}`);
        }

        console.log(`  ✓ ${pkg.name} verified (${files.length} files in dist/)`);
        passed.push(pkg);
    } catch (error) {
        console.error(`  ✗ ${pkg.name}: ${error.message}`);
        failed.push({...pkg, error: error.message});
    }
}


console.log(`\n${passed.length} passed, ${failed.length} failed.`);

const outputFile = process.env.GITHUB_OUTPUT;
if (outputFile) {
    const delimiter = `EOF_${Date.now()}`;

    const passedJson = JSON.stringify(passed);
    fs.appendFileSync(outputFile, `passed<<${delimiter}\n${passedJson}\n${delimiter}\n`);

    const failedJson = JSON.stringify(failed);
    fs.appendFileSync(outputFile, `failed<<${delimiter}_2\n${failedJson}\n${delimiter}_2\n`);

    fs.appendFileSync(outputFile, `has_publishable=${passed.length > 0}\n`);
    fs.appendFileSync(outputFile, `all_failed=${passed.length === 0}\n`);
}

if (passed.length === 0) {
    console.error('\nAll packages failed verification.');
    process.exit(1);
}

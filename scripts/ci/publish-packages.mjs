import path from 'node:path';
import {execSync} from 'node:child_process';

/**
 * Publishes packages that passed build verification.
 * Expects PUBLISH_CHANGES env var with JSON array of {name, from, to, dir}.
 * dir is relative to the repository root.
 *
 * Assumes:
 * - Build artifacts (dist/, lib/) are already present (from artifact download)
 * - Docs have already been generated (from check job)
 * - Dependencies are installed via npm ci --ignore-scripts
 *
 * After each publish it pushes the release tag: `v<version>` for core, `<name>-<version>` for a plugin
 * (the tags the changelog links and publish-check's commit list use). A failed tag only warns.
 */

const changes = JSON.parse(process.env.PUBLISH_CHANGES || '[]');

if (changes.length === 0) {
    console.log('No packages to publish.');
    process.exit(0);
}

const repoRoot = path.resolve(import.meta.dirname, '../..');
const cleanPackageBin = path.resolve(repoRoot, 'node_modules/.bin/clean-package');
let failed = 0;

for (const pkg of changes) {
    const cwd = path.resolve(repoRoot, pkg.dir);
    const isCore = pkg.dir === '.';
    const accessFlag = isCore ? '' : '--access public';

    console.log(`\nPublishing ${pkg.name}@${pkg.to}...`);
    try {
        // Clean package.json for publishing
        execSync(cleanPackageBin, {cwd, stdio: 'inherit'});

        try {
            // Pack
            const tarball = execSync('npm pack --silent', {cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit']}).trim();
            console.log(`  Packed: ${tarball}`);

            // Publish
            execSync(`npm publish --provenance ${accessFlag} "${tarball}"`, {cwd, stdio: 'inherit'});
            console.log(`  ✓ Published ${pkg.name}@${pkg.to}`);
            const tag = isCore ? `v${pkg.to}` : `${pkg.name}-${pkg.to}`;
            try {
                execSync(`git tag "${tag}" && git push origin "refs/tags/${tag}"`, {cwd: repoRoot, stdio: 'inherit'});
                console.log(`  ✓ Tagged ${tag}`);
            } catch (e) {
                console.warn(`  ! Published, but could not push the tag ${tag}: ${e.message}`);
            }
        } finally {
            // Always restore package.json
            execSync(`${cleanPackageBin} restore`, {cwd, stdio: 'inherit'});
        }
    } catch (error) {
        console.error(`  ✗ Failed to publish ${pkg.name}@${pkg.to}: ${error.message}`);
        failed++;
    }
}

if (failed > 0) {
    console.error(`\n${failed} package(s) failed to publish.`);
    process.exit(1);
}

console.log(`\n✓ All ${changes.length} package(s) published successfully.`);

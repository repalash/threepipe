import path from 'node:path';
import {execSync} from 'node:child_process';

/**
 * Publishes packages that were detected as changed by publish-check.mjs.
 * Expects PUBLISH_CHANGES env var with JSON array of {name, from, to, dir}.
 * dir is relative to the repository root.
 */

const changes = JSON.parse(process.env.PUBLISH_CHANGES || '[]');

if (changes.length === 0) {
    console.log('No packages to publish.');
    process.exit(0);
}

const repoRoot = path.resolve(import.meta.dirname, '../..');
let failed = 0;

for (const pkg of changes) {
    const cwd = path.resolve(repoRoot, pkg.dir);
    console.log(`\nPublishing ${pkg.name}@${pkg.to}...`);
    try {
        const isCore = !pkg.name.startsWith('@');
        const accessFlag = isCore ? '' : '--access public';

        // Run new:pack to build, generate docs, and create tarball
        const tarball = execSync('npm run -s new:pack', {cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit']}).trim();
        console.log(`  Packed: ${tarball}`);

        // Publish the tarball
        execSync(`npm publish ${accessFlag} "${tarball}"`, {cwd, stdio: 'inherit'});
        console.log(`  ✓ Published ${pkg.name}@${pkg.to}`);
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

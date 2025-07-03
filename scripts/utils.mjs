import path from 'node:path';
import fs from 'node:fs';
import {execSync, spawn} from 'node:child_process';

export function loopPluginDirs (callback) {
    const pathname = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1')
    const __dirname = path.dirname(pathname);
    const pluginsDir = path.resolve(__dirname, '../plugins')
    const pluginFolders = fs.readdirSync(pluginsDir)

    for (const pluginFolder of pluginFolders) {
        const pluginDir = path.join(pluginsDir, pluginFolder)
        const packageJsonPath = path.join(pluginDir, 'package.json')
        if (!fs.existsSync(packageJsonPath)) continue;
        callback(pluginDir, pluginFolder)
    }
}

export function execEachPlugin (command, templates = false) {
    loopPluginDirs((pluginDir, pluginFolder) => {
        if (!templates && pluginFolder.startsWith('plugin-template-')) return;
        console.log(`Executing ${command} in ${pluginDir}`)
        execSync(command, {cwd: pluginDir, stdio: 'inherit'})
    })
}

// New parallel execution functions
export function getPluginDependencies (templates = false) {
    const plugins = new Map();

    loopPluginDirs((pluginDir, pluginFolder) => {
        if (!templates && pluginFolder.startsWith('plugin-template-')) return;

        const packageJsonPath = path.join(pluginDir, 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

        const dependencies = packageJson.dependencies || {};
        const devDependencies = packageJson.devDependencies || {};

        // Find local file dependencies (other plugins)
        const localDeps = [];
        const allDeps = {...dependencies, ...devDependencies};

        for (const [depName, depVersion] of Object.entries(allDeps)) {
            if (depVersion.startsWith('file:./../')) {
                // Extract the plugin name from the file path
                const filePath = depVersion.replace('file:./../', '');
                const packageName = filePath.replace(/\/src\/$/, '')
                if(!packageName.includes('/') && !packageName.includes('..'))
                    localDeps.push(packageName);
            }
        }

        plugins.set(pluginFolder, {
            name: pluginFolder,
            dir: pluginDir,
            deps: localDeps,
        });
    });

    return plugins;
}

export function createInstallPlan (plugins) {
    const plan = [];
    const processed = new Set();
    const processing = new Set();

    function addToLevel (pluginName, level = 0) {
        if (processed.has(pluginName) || processing.has(pluginName)) {
            return level;
        }

        processing.add(pluginName);
        const plugin = plugins.get(pluginName);

        if (!plugin) {
            processing.delete(pluginName);
            return level;
        }

        let maxDepLevel = -1;

        // Process dependencies first
        for (const dep of plugin.deps) {
            const depLevel = addToLevel(dep, level);
            maxDepLevel = Math.max(maxDepLevel, depLevel);
        }

        const currentLevel = maxDepLevel + 1;

        // Ensure we have enough levels in the plan
        while (plan.length <= currentLevel) {
            plan.push([]);
        }

        plan[currentLevel].push(plugin);
        processed.add(pluginName);
        processing.delete(pluginName);

        return currentLevel;
    }

    // Add all plugins to the plan
    for (const pluginName of plugins.keys()) {
        addToLevel(pluginName);
    }

    return plan.filter(level => level.length > 0);
}

export async function execCommand (command, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn('npm', command.split(' ').slice(1), {
            cwd,
            stdio: 'pipe',
            shell: true,
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve({stdout, stderr});
            } else {
                reject(new Error(`Command failed with code ${code}: ${stderr}`));
            }
        });
    });
}

export async function execEachPluginParallel (command, templates = false) {
    console.log('Building dependency graph for parallel execution...');

    const plugins = getPluginDependencies(templates);
    const installPlan = createInstallPlan(plugins);

    console.log(`\nInstallation plan (${installPlan.length} levels):`);
    installPlan.forEach((level, index) => {
        console.log(`Level ${index + 1}: ${level.map(p => p.name).join(', ')}`);
    });

    console.log(`\nExecuting '${command}' in parallel...`);

    for (let levelIndex = 0; levelIndex < installPlan.length; levelIndex++) {
        const level = installPlan[levelIndex];
        console.log(`\n--- Level ${levelIndex + 1} (${level.length} plugins) ---`);

        const run = async (plugin) => {
            const startTime = Date.now();
            console.log(`Starting: ${command} in ${plugin.name}`);

            try {
                const result = await execCommand(`npm ${command}`, plugin.dir);
                const duration = Date.now() - startTime;
                console.log(`✓ Completed: ${plugin.name} (${duration}ms)`);
                return {plugin: plugin.name, success: true, duration};
            } catch (error) {
                const duration = Date.now() - startTime;
                console.error(`✗ Failed: ${plugin.name} (${duration}ms)`);
                console.error(`Error: ${error.message}`);
                return {plugin: plugin.name, success: false, duration, error: error.message};
            }
        }

        const n = 6;
        const groups = []
        for (let i = 0; i < level.length; i += n) {
            groups.push(level.slice(i, i + n));
        }
        const results = []
        // Execute all plugins in this level in parallel
        for (const group of groups) {
            results.push(...await Promise.all(group.map(run)));
        }

        // Check if any failed
        const failures = results.filter(r => !r.success);
        if (failures.length > 0) {
            console.error(`\n❌ ${failures.length} plugin(s) failed in level ${levelIndex + 1}:`);
            failures.forEach(failure => {
                console.error(`  - ${failure.plugin}: ${failure.error}`);
            });
            throw new Error(`Installation failed for ${failures.length} plugin(s)`);
        }

        const totalTime = Math.max(...results.map(r => r.duration));
        console.log(`✓ Level ${levelIndex + 1} completed in ${totalTime}ms`);
    }

    console.log('\n🎉 All plugins processed successfully!');
}

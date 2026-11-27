import path from 'node:path';
import fs from 'node:fs';

export function loopPluginDirs (callback) {
    const pluginsDir = path.resolve(import.meta.dirname, '../plugins')
    const pluginFolders = fs.readdirSync(pluginsDir)

    for (const pluginFolder of pluginFolders) {
        const pluginDir = path.join(pluginsDir, pluginFolder)
        const packageJsonPath = path.join(pluginDir, 'package.json')
        if (!fs.existsSync(packageJsonPath)) continue;
        callback(pluginDir, pluginFolder)
    }
}

import path from 'node:path';
import fs from 'node:fs';
import {execSync} from 'node:child_process';

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
        if(!templates && pluginFolder.startsWith('plugin-template-')) return;
        console.log(`Executing ${command} in ${pluginDir}`)
        execSync(command, {cwd: pluginDir, stdio: 'inherit'})
    })
}

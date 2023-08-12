import path from "node:path";
import fs from "node:fs";
import {execSync} from "node:child_process";

export function loopPluginDirs(callback){
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    const pluginsDir = path.join(__dirname, '../plugins')
    const pluginFolders = fs.readdirSync(pluginsDir)

    for (const pluginFolder of pluginFolders) {
        const pluginDir = path.join(pluginsDir, pluginFolder)
        const packageJsonPath = path.join(pluginDir, 'package.json')
        if (!fs.existsSync(packageJsonPath)) continue;
        callback(pluginDir)
    }

}

export function execEachPlugin(command){
    loopPluginDirs((pluginDir) => {
        console.log(`Executing ${command} in ${pluginDir}`)
        execSync(command, {cwd: pluginDir, stdio: 'inherit'})
    })
}

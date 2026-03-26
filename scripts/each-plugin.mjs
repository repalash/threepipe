import {execEachPlugin} from "./utils.mjs";

const command = process.argv.slice(2).join(' ')
if(!command) throw new Error('Command is required, usage example: `node scripts/each-plugin.mjs run build`')
console.log(`Executing '${command}' in all plugins`)

// Each plugin should have "prepare" that will also build the plugin
execEachPlugin(`npm ${command}`) // install dependencies

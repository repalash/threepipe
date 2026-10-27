// npm install (prepare): build the core, install and build every plugin, build the examples, print the help.
// A failed plugin install does not stop the examples build; the install still fails at the end. In Node, not in the
// npm script, because npm runs scripts with cmd.exe on Windows, which has no `{ ...; s=$?; }`.
import {spawnSync} from 'node:child_process'

const run = (script) => spawnSync('npm', ['run', script], {stdio: 'inherit', shell: true}).status ?? 1

if (run('build') !== 0) process.exit(1)
const plugins = run('build-plugins')
if (run('build-examples') !== 0) process.exit(1)
await import('./dev-help.mjs')
process.exit(plugins)

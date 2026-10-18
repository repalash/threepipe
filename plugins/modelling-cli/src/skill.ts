/**
 * `npm run modelling:skill` - write `skills/threepipe-modelling/SKILL.md` and `.claude-plugin/` under `--root`
 * (default: the current directory), from the command registry and the cookbook.
 */

import {quietViewerConsole} from './cli/stdio'
import './node/polyfill'
import {mkdir, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {ThreeViewer} from 'threepipe'
import {NodeSession} from './node/NodeSession'
import {renderMarketplace, renderPluginManifest, renderSkill, SkillCommandInfo} from './skill/generate'
import modellingPackage from '../../modelling/package.json'

quietViewerConsole(ThreeViewer as never)

const argv = process.argv.slice(2)
const i = argv.indexOf('--root')
const root = resolve(i >= 0 ? argv[i + 1] : process.cwd())
const session = new NodeSession()
const commands = session.modelling.describeCommands() as SkillCommandInfo[]
session.dispose()
const version = modellingPackage.version
const skillDir = join(root, 'skills', 'threepipe-modelling')
await mkdir(skillDir, {recursive: true})
await mkdir(join(root, '.claude-plugin'), {recursive: true})
await writeFile(join(skillDir, 'SKILL.md'), renderSkill(commands, version))
await writeFile(join(root, '.claude-plugin', 'plugin.json'), renderPluginManifest(version))
await writeFile(join(root, '.claude-plugin', 'marketplace.json'), renderMarketplace(version))
process.stdout.write(JSON.stringify({ok: true, commands: commands.length, version,
    wrote: [join(skillDir, 'SKILL.md'), join(root, '.claude-plugin', 'plugin.json'), join(root, '.claude-plugin', 'marketplace.json')]}) + '\n')

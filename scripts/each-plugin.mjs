import {execEachPlugin, execEachPluginParallel} from './utils.mjs';

const args = process.argv.slice(2);
const command = args.join(' ');

if (!command) {
    throw new Error('Command is required');
}

// Check if parallel flag is provided
const isParallel = args.includes('--parallel') || args.includes('-p');
const cleanCommand = command.replace(/--parallel|-p/g, '').trim();

if (!cleanCommand) {
    throw new Error('Command is required');
}

console.log(`Executing '${cleanCommand}' in all plugins${isParallel ? ' (parallel mode)' : ''}`);

try {
    if (isParallel) {
        // Use parallel execution
        await execEachPluginParallel(cleanCommand);
    } else {
        // Use sequential execution (original behavior)
        execEachPlugin(`npm ${cleanCommand}`);
    }
} catch (error) {
    console.error('❌ Execution failed:', error.message);
    process.exit(1);
}

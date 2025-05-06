import fs from 'fs'
import dotenv from 'dotenv'

// read .env file if exists
const envFilePath = './examples/.env'
if (fs.existsSync(envFilePath)) {
    dotenv.config({ path: envFilePath })
}

// Filter EX_ variables from environment
const envVars = Object.entries(process.env)
    .filter(([key]) => key.startsWith('TP_EX_'))
    .reduce((acc, [key, value]) => {
        acc[key.replace('TP_EX_', '')] = value
        return acc
    }, {})

// Generate globals.js
const jsOutput = Object.entries(envVars)
    .map(([key, val]) => `export const ${key} = ${JSON.stringify(val)}`)
    .join('\n') + '\n'
fs.writeFileSync('./examples/globals.js', jsOutput, 'utf8')

// Generate globals.d.ts
const dtsOutput = Object.entries(envVars)
    .map(([key, value]) => `export const ${key}: ${typeof value}`)
    .join('\n') + '\n'

fs.writeFileSync('./examples/globals.d.ts', dtsOutput, 'utf8')

console.log('✅ globals.js and globals.d.ts generated.')

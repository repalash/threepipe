import fs from 'fs'
import dotenv from 'dotenv'

// read .env file if exists
const envFilePath = './examples/.env'
if (fs.existsSync(envFilePath)) {
    dotenv.config({ path: envFilePath })
}

// Parse DOT_ENV_CONTENT environment variable as .env file if it exists(for ci)
if (process.env.DOT_ENV_CONTENT) {
    const envConfig = dotenv.parse(process.env.TP_EX)
    for (const key in envConfig) {
        process.env[key] = envConfig[key]
    }
}

// Filter EX_ variables from environment
const envVars = Object.entries(process.env)
    .filter(([key]) => key.startsWith('TP_EX_'))
    .reduce((acc, [key, value]) => {
        acc[key.replace('TP_EX_', '')] = value
        return acc
    }, {'DUMMY': '1'}) // dummy to prevent empty file which is not a module apparently

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

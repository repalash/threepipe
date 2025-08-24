import fs from 'fs/promises';
import path from 'path';

const distDir = 'lib/';
const assetsDir = 'lib/';

// Mapping of source extensions (in imports) → replacement in built JS
const importMap = {
    ['scss\\?inline']: 'css.js', // points to compiled CSS
    ['css\\?inline']: 'css.js',
    glsl: 'glsl.js',
};

// File types in assetsDir that should become JS modules
const assetExts = ['css', 'glsl'];

async function processFile (jsFile) {
    const content1 = await fs.readFile(jsFile, 'utf-8');
    let content = content1;
    // Replace imports dynamically
    for (const [ext, replacement] of Object.entries(importMap)) {
        const regex = new RegExp(
            `(import\\s+[^'"]+['"])(\\.\\/[^'"]+)\\.${ext}(['"])`,
            'g',
        );
        content = content.replace(regex, `$1$2.${replacement}$3`);
    }

    if(content === content1) {
        return; // No changes
    }
    await fs.writeFile(jsFile, content);
    console.log(`✅ Updated imports in ${jsFile}`);
}

async function createAssetJS (assetFile, newExt) {
    const content = await fs.readFile(assetFile, 'utf-8');
    const jsModule = `export default ${JSON.stringify(content)};\n`;

    // Replace assetsDir with distDir and append .js
    const jsFile = assetFile.replace(assetsDir, distDir) + '.js';
    await fs.writeFile(jsFile, jsModule);
    console.log(`🧩 Created ${jsFile}`);
}

async function main () {
    // 1. Update imports in dist .js files
    const jsFiles = (await fs.readdir('./' + distDir, {recursive: true}))
        .filter(file => file.endsWith('.js'))
        .map(file => path.join('./' + distDir, file));

    await Promise.all(jsFiles.map(processFile));

    // 2. Create JS modules for asset types (css, glsl, …)
    for (const ext of assetExts) {
        const files = (await fs.readdir('./' + assetsDir, {recursive: true}))
            .filter(file => file.endsWith('.' + ext))
            .map(file => path.join('./' + assetsDir, file));

        await Promise.all(files.map(file => createAssetJS(file, ext + '.js')));
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

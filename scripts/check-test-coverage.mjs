import path from "node:path"
import fs from "node:fs"
import {execSync} from "node:child_process"

function checkTestCoverage(testDir, testFile, ignoredFolders, testingFile){
    // npx playwright test --list --reporter=json
    const pathname = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1')
    const __dirname = path.dirname(pathname);
    const dir = path.resolve(__dirname, '../'+testDir)
    const folders = fs.readdirSync(dir, {withFileTypes: true})
        .filter(dirent => dirent.isDirectory() && fs.existsSync(path.join(dir, dirent.name, testingFile)))
        .map(dirent => dirent.name)
        .filter(d => !ignoredFolders.includes(d))

    const json = execSync(`npx playwright test ${testFile} --list --reporter=json`, {cwd: path.resolve(__dirname, '..')})
    const tests = JSON.parse(json.toString()).suites.find(s => s.file === testFile).specs
    const titles = tests.map(t => t.title)

    const folderSet = new Set(folders)
    const titleSet = new Set(titles)
    let result = true
    for (const folder of folders) {
        if(!titleSet.has(folder)) {
            console.error(`No test for ${testDir}/${folder}`)
            result = false
        }
    }
    for (const title of titles) {
        if(!folderSet.has(title)) {
            console.error(`No testing file ${testDir}/${title}/${testingFile} found for test ${testFile}:${title}`)
            result = false
        }
    }
    return result
}


function checkTestCoverageExamples(){
    const testDir = 'examples'
    const testFile = 'example.spec.ts'
    const ignored = ['examples-utils']
    const testingFile = 'index.html'

    return checkTestCoverage(testDir, testFile, ignored, testingFile)
}

let result = true

result = result && checkTestCoverageExamples()

if(!result) process.exit(1)

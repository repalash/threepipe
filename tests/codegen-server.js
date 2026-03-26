import {chromium} from '@playwright/test'
import {exec} from 'child_process'

(async () => {

    const child = exec('npm run serve', {stdio: 'inherit'});
    // Make sure to run headed.
    const browser = await chromium.launch({ headless: false });

    // Setup context however you like.
    // const context = await browser.newContext({ /* pass any options */ });
    // await context.route('**/*', route => route.continue());

    // Pause the page, and start recording manually.
    const page = await browser.newPage();
    // await page.goto('http://127.0.0.1:9229/examples/image-snapshot-export/');
    await page.pause();

    child.kill();

})();


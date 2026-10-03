# Host GPU browser for WebGL runs from the container

In the aibox container Chromium renders WebGL on SwiftShader (software, arm64). It is slow, heavy examples
hit the screenshot timeouts, and its pixels are not comparable with x64 CI or a real GPU. Palash runs a
Playwright browser server on his Mac (`chromium.launchServer`, port 3145, Metal via ANGLE on the M4 Pro);
the container drives it and the renders happen on the GPU.

First used 2026-10-02 for the r163 → r168 A/B comparison of all examples
(`.repos/threepipe-three-upgrade/tmp/ab/mac-ab.cjs`): 195 examples × 3 renders in ~35 minutes, repeat
renders pixel-identical.

## Use

1. If `curl -s -H 'Host: 127.0.0.1:3145' http://host.docker.internal:3145/json` does not answer, ask the
   user to start the server on the Mac. You cannot start it from here.
2. The client must be **exactly** the server's Playwright version (1.63.0 on 2026-10-03). Install it outside
   every project: `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --prefix /tmp/pw playwright@<version>`.
   Never change a project's own Playwright for this.
3. Check: `node scripts/remote-browser/connect.mjs` prints `browser <version> — ANGLE (Apple, ANGLE Metal
   Renderer: Apple M4 Pro, …)`. SwiftShader in that line means you are not on the host.
4. In a driver: `connectHostBrowser()` from `connect.mjs`, `browser.newContext()`, and `browser.close()`
   once at the very end in a `finally`.

## What is different from a local browser

- **The browser is on the Mac.** `127.0.0.1` inside a page is the Mac. Serve the container's tree on
  `0.0.0.0` and open it as `http://<port>.$AIBOX_URL_BASE` (`npm run serve`/`npm run vite -- --host 0.0.0.0
  --port <port>`); the Mac fetches CDN assets itself. Files only the container has: pass bytes from node
  (`page.evaluate` with base64) or copy them under the served tree.
- **The `Host` header must be `127.0.0.1:3145`** (`chromium.connect(url, {headers: {Host: '127.0.0.1:3145'}})`);
  anything else is refused with 403. `connect.mjs` sets it.
- **The ws path changes on every server start.** `connect.mjs` reads the current one from `/json`.
- **Closing any page or context ends the browser for every connected client** within ~0.5 s ("Browser
  closed"), not only the last page, and not only your own (verified 2026-10-02 and 2026-10-03 with two
  clients). So: never close pages mid-run — navigate finished pages to `about:blank` to release their GL
  context — call `browser.close()` once at the end, then wait ~6 s before reconnecting. Retry on
  "Browser closed": other sessions share the server and knock each other out.
- Because of the above, the stock Playwright test runner (`npm run test:e2e`) cannot use the server: it
  closes a context after every test. Write a driver (per example: load, wait for `body._testFinish`, the
  same pre-screenshot steps as `tests/helpers.ts`, screenshot) as `mac-ab.cjs` does.
- `navigator.gpu` was absent in the headless shell build; WebGL2 works.
- Screenshots are taken by the driver and land in the container; save them under the project
  (`tmp/browser-check/` or the worktree's `tmp/`) so the user can open them.
- Load a file into a page with `page.setInputFiles` or a `DataTransfer` drop built from bytes; the Mac cannot
  read container paths.

## Fallback

Playwright's bundled Chromium with SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`,
what `playwright.config.ts` does). Use `PLAYWRIGHT_WORKERS=2` and expect the heavy examples to time out.

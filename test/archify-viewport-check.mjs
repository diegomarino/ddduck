// Manual Chrome regression: node test/archify-viewport-check.mjs <atlas-index.html> <archify-package-root>
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [index, archify] = process.argv.slice(2);
assert.ok(
  index && archify,
  "Pass an exported atlas index and the upstream Archify package containing bin/visual-check.mjs",
);
const { ChromeVisualBrowser, findChrome } = await import(pathToFileURL(path.resolve(archify, "bin/visual-check.mjs")));
const browser = new ChromeVisualBrowser(findChrome());
try {
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const loaded = browser.cdp.waitFor("Page.loadEventFired", session);
  await send("Page.navigate", { url: pathToFileURL(path.resolve(index)).href });
  await loaded;
  for (const [width, height] of [
    [1174, 900],
    [1175, 900],
    [1440, 900],
    [1100, 600],
    [375, 700],
  ]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    const result = await send("Runtime.evaluate", {
      expression: `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const frame = document.getElementById('diagram').getBoundingClientRect();
        const header = document.querySelector('header').getBoundingClientRect();
        resolve({top: frame.top, headerBottom: header.bottom, bottom: frame.bottom,
          viewport: innerHeight, scrollHeight: document.documentElement.scrollHeight,
          scrollWidth: document.documentElement.scrollWidth, width: innerWidth});
      })))`,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.equal(result.exceptionDetails, undefined);
    const layout = result.result.value;
    assert.ok(Math.abs(layout.top - layout.headerBottom) < 1, `${width}x${height}: gap below header`);
    assert.ok(
      Math.abs(layout.bottom - layout.viewport) < 1,
      `${width}x${height}: frame ends at ${layout.bottom}, viewport ends at ${layout.viewport}`,
    );
    assert.ok(layout.scrollHeight <= height, `${width}x${height}: outer page scrolls vertically`);
    assert.ok(layout.scrollWidth <= width, `${width}x${height}: outer page overflows horizontally`);
    console.log(`${width}x${height}: viewer fills the remaining viewport`);
  }
} finally {
  await browser.close();
}

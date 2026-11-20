/* global document, getComputedStyle */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const source = path.join(root, 'docs', 'report', 'project-report.html');
const output = path.join(root, 'output', 'pdf', 'FinSight-Project-Report.pdf');
await mkdir(path.dirname(output), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
await page.emulateMedia({ media: 'print' });
await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((image) => (
    image.complete ? Promise.resolve() : new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    })
  )));
});

const audit = await page.evaluate(() => [...document.querySelectorAll('.page')].map((element, index) => {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const limit = rect.bottom - parseFloat(style.paddingBottom) - 1;
  const offenders = [...element.querySelectorAll('*')]
    .filter((node) => !node.closest('.runfoot'))
    .filter((node) => {
      const box = node.getBoundingClientRect();
      return box.height > 0 && box.bottom > limit;
    })
    .slice(0, 8)
    .map((node) => ({
      tag: node.tagName,
      className: typeof node.className === 'string' ? node.className : '',
      text: (node.textContent || '').trim().slice(0, 60),
      pastBottom: Math.round(node.getBoundingClientRect().bottom - rect.bottom),
    }));
  return {
    page: index + 1,
    orientation: style.width === '297mm' ? 'landscape' : 'portrait',
    overflow: Math.round(element.scrollHeight - element.clientHeight),
    offenders,
  };
}));

const dirty = audit.filter((entry) => entry.overflow > 1 || entry.offenders.length > 0);
console.log(JSON.stringify({ pages: audit.length, dirty }, null, 2));

await page.pdf({
  path: output,
  printBackground: true,
  preferCSSPageSize: true,
  outline: true,
  tagged: true,
});
await browser.close();
console.log(`Wrote ${path.relative(root, output)}`);

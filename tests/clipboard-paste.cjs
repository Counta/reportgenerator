// Run against a local dev/preview server with Playwright installed in the test environment.
// Optional: REPORT_DRAWER_URL, PLAYWRIGHT_MODULE, CHROME_PATH.
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  })
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(process.env.REPORT_DRAWER_URL || 'http://127.0.0.1:4173')
    await page.getByRole('button', { name: '新建报告', exact: true }).click()
    const editors = page.locator('.unified-content-editor')
    const readContent = () => page.evaluate(() => JSON.parse(localStorage.getItem('report-drawer:reports:v1'))[0].values.content || '')
    await page.evaluate(() => {
      window.pasteInputCount = 0
      document.addEventListener('input', event => {
        if (event.target.matches('.unified-content-editor')) window.pasteInputCount++
      })
    })

    async function paste(index, text, replace = false) {
      await editors.nth(index).focus()
      if (replace) await page.keyboard.press('Control+A')
      await page.evaluate(async text => {
        window.pasteInputCount = 0
        await navigator.clipboard.writeText(text)
      }, text)
      await page.keyboard.press('Control+V')
      await page.waitForFunction(() => window.pasteInputCount > 0)
      assert.equal(await page.evaluate(() => window.pasteInputCount), 1, 'one input event per paste')
    }

    const multiline = '第一段唯一标记\n\n第二段 <b>只作文字</b>\n末行  '
    await paste(0, multiline)
    assert.equal(await readContent(), multiline)
    // Intentionally paste twice: exactly two copies, not an arbitrary deduplication rule.
    await paste(0, multiline)
    assert.equal(await readContent(), multiline + multiline)
    await paste(0, '选区替换后唯一一份', true)
    assert.equal(await readContent(), '选区替换后唯一一份')

    const lines = Array.from({ length: 30 }, (_, i) => `行${String(i).padStart(2, '0')}：跨页原文唯一标记`)
    await paste(0, lines.join('\n'), true)
    assert.equal(await readContent(), lines.join('\n'), 'long text remains exactly one copy')
    const continuation = '第二页新内容\n\n末尾唯一标记'
    await paste(1, continuation, true)
    const expected = lines.slice(0, 22).join('\n') + '\n' + continuation
    assert.equal(await readContent(), expected, 'page 2 replaces only its continuation')
    // Let the existing text-history debounce finish, then test the real toolbar history.
    await page.waitForTimeout(450)
    await page.getByTitle('撤销 (Ctrl+Z)', { exact: true }).click()
    assert.equal(await readContent(), '')
    await page.getByTitle('重做 (Ctrl+Y)', { exact: true }).click()
    assert.equal(await readContent(), expected)

    // Paste image data through the actual clipboard, then paste multiline text next to spacers.
    for (const index of [0, 1]) {
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 400
        canvas.height = 200
        canvas.getContext('2d').fillRect(0, 0, 400, 200)
        const blob = await new Promise(resolve => canvas.toBlob(resolve))
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      })
      await editors.nth(index).focus()
      await page.keyboard.press('Control+V')
      await page.waitForFunction(count => JSON.parse(localStorage.getItem('report-drawer:reports:v1'))[0].images.length === count, index + 1)
      const imageText = `第${index + 1}页图片旁唯一标记\n\n第二行\n尾行`
      // Ctrl+A selects only this page's lines; text that flowed to the other page is kept.
      const before = await readContent()
      const keptAfter = await editors.nth(1).evaluate((el, src) => {
        const first = el.querySelector('.flow-line')
        return first ? src.slice(Number(first.dataset.start)) : ''
      }, before)
      await paste(index, imageText, true)
      const actual = await readContent()
      assert.equal(actual.split(imageText).length - 1, 1, 'image-adjacent text inserted once')
      if (index === 0) assert.equal(actual, imageText + keptAfter, 'page 1 replaces only its own lines')
      const overlaps = await page.evaluate(pageIndex => {
        const pageEl = document.querySelectorAll('.page-editor')[pageIndex]
        const images = [...pageEl.querySelectorAll('.image-overlay')].map(el => el.getBoundingClientRect())
        return [...pageEl.querySelectorAll('.flow-line')].filter(line => {
          if (!line.textContent) return false
          const r = line.getBoundingClientRect()
          return images.some(i => r.left < i.right && r.right > i.left && r.top < i.bottom && r.bottom > i.top)
        }).length
      }, index)
      assert.equal(overlaps, 0, 'text lines never overlap images')
    }
    const saved = await readContent()
    await page.reload()
    await editors.first().waitFor()
    assert.equal(await readContent(), saved, 'reload preserves exact text')
    if (process.env.SCREENSHOT_PATH) {
      await editors.nth(1).scrollIntoViewIfNeeded()
      await page.screenshot({ path: process.env.SCREENSHOT_PATH })
    }
    assert.deepEqual(errors, [])
    console.log('PASS: exact text, multiline, repeated paste, selection replacement, cross-page, one input per paste, undo/redo, images on both pages, reload')
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })


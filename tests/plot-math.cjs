// node tests/plot-math.cjs — no browser required.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

async function main() {
  const source = fs.readFileSync('src/lib/plot.ts', 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } })
  const m = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
  const d = m.newPlot(), c = d.curves[0]
  assert.equal(m.plotError(d), '')
  assert.equal(m.waveValue(c, 0), 1)
  assert.equal(m.waveValue(c, 0.999), 1)
  assert.equal(m.waveValue(c, 1), -1)
  assert.equal(m.waveValue(c, 2), 1)
  assert.deepEqual(m.jumpEvents(c, 0, 6).map(e => e.x), [1, 2, 3, 4, 5, 6])
  c.period = 2.5; c.phase = -0.25; c.duty = 0.2
  assert.deepEqual(m.jumpEvents(c, 0, 6).map(e => e.x), [0.25, 2.25, 2.75, 4.75, 5.25])
  const nodes = m.templateNodes(c, d)
  assert.deepEqual(nodes.slice(0, 3), [{ x: 0, y: 1, next: 'hold' }, { x: 0.25, y: -1, next: 'hold' }, { x: 2.25, y: 1, next: 'hold' }])
  d.joinJumps = false
  assert.ok(m.plotSvg(d).includes('fill="white" stroke="#2563eb"'))
  d.title = '<script>alert(1)</script>'
  assert.ok(!m.plotSvg(d).includes('<script>'))
  const copy = m.clonePlot(d); copy.curves[0].nodes[0].x = 99
  assert.notEqual(d.curves[0].nodes[0].x, 99)
  for (const kind of ['sin', 'cos']) {
    const w = m.newCurve(kind)
    assert.ok(Math.abs(m.waveValue(w, kind === 'sin' ? 0.5 : 0) - 1) < 1e-12)
    assert.ok(Math.abs(m.waveValue(w, kind === 'sin' ? 1.5 : 1) + 1) < 1e-12)
  }
  const saw = m.newCurve('saw')
  assert.deepEqual(m.jumpEvents(saw, 0, 4).map(e => [e.x, e.before, e.after]), [[2, 1, -1], [4, 1, -1]])
  const custom = m.newCurve('nodes')
  custom.repeat = true; custom.period = 2; custom.phase = 0.25
  custom.nodes = [{ x: 0, y: 0.2, next: 'hold' }, { x: 0.3, y: 1, next: 'line' }, { x: 1.1, y: -0.4, next: 'hold' }, { x: 2, y: 0.6, next: 'line' }]
  const pd = { ...m.newPlot(), curves: [custom] }
  assert.equal(m.plotError(pd), '')
  const tiled = m.expandedNodes(custom, pd)
  assert.deepEqual(tiled.filter(n => n.x >= 0.25 && n.x <= 2.55).map(n => [n.x, n.y]), [[0.25, 0.6], [0.25, 0.2], [0.55, 1], [1.35, -0.4], [2.25, 0.6], [2.25, 0.2], [2.55, 1]])
  const saved = m.clonePlot(pd)
  pd.curves[0].nodes[1].y = 1.4
  assert.equal(pd.curves[0].nodes[2].y, -0.4, 'changing one side never mirrors the other')
  assert.equal(saved.curves[0].nodes[1].y, 1, 'cycle sources are deep cloned')
  assert.ok(m.plotSvg(pd).includes('stroke-width="2.4"'))
  pd.curves[0].nodes[0].x = 0.1
  assert.ok(m.plotError(pd).includes('单周期'))
  assert.deepEqual(m.fromScreen(d, ...m.toScreen(d, 1, -0.5)), [1, -0.5])
  d.xMax = d.xMin
  assert.ok(m.plotError(d)); assert.equal(m.plotSvg(d), '')
  console.log('PASS: analytic jumps, duty/phase, node conversion, sine/cosine, SVG escaping, deep clone and bounds')
}
main().catch(e => { console.error(e); process.exitCode = 1 })

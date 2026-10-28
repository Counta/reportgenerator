/**
 * Math helpers for the chart editor: a small safe expression compiler (no eval).
 */
export type Fn = (x: number) => number

// ---------- Expression compiler ----------

const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10, lg: Math.log10,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  min: Math.min, max: Math.max, pow: Math.pow,
}
const CONSTANTS: Record<string, number> = { pi: Math.PI, 'π': Math.PI, e: Math.E }

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string }

function normalize(src: string): string {
  return src.replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[，]/g, ',')
    .replace(/[×·∙]/g, '*').replace(/[÷]/g, '/').replace(/[−–]/g, '-').replace(/\*\*/g, '^')
}
function tokenize(src: string): Token[] {
  const s = normalize(src)
  const out: Token[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) { i++; continue }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i))
    if (num) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue }
    const id = /^[A-Za-z_\u0370-\u03ff][A-Za-z0-9_\u0370-\u03ff]*/.exec(s.slice(i))
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue }
    if ('+-*/^(),'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue }
    throw new Error(`无法识别的字符“${ch}”`)
  }
  return out
}

/**
 * Compile an expression in one variable. `vars` lists accepted variable names (e.g. ['x', 'U']).
 * Supports + - * / ^, implicit multiplication (2x, 3(x+1)), constants pi/e and common functions.
 */
export function compileExpr(src: string, vars: string[]): Fn {
  const tokens = tokenize(src)
  if (!tokens.length) throw new Error('表达式为空')
  let p = 0
  const peek = () => tokens[p]
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v
  const expect = (v: string) => { if (!isOp(v)) throw new Error(`缺少“${v}”`); p++ }

  function add(): Fn {
    let left = mul()
    while (isOp('+') || isOp('-')) {
      const op = tokens[p++].v, l = left, r = mul()
      left = op === '+' ? x => l(x) + r(x) : x => l(x) - r(x)
    }
    return left
  }
  function mul(): Fn {
    let left = unary()
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = tokens[p++].v, l = left, r = unary()
        left = op === '*' ? x => l(x) * r(x) : x => l(x) / r(x)
      } else if (peek() && (peek()!.t !== 'op' || peek()!.v === '(')) {
        const l = left, r = unary() // implicit multiplication: 2x, 3(x+1), x sin(x)
        left = x => l(x) * r(x)
      } else return left
    }
  }
  function unary(): Fn {
    if (isOp('-')) { p++; const f = unary(); return x => -f(x) }
    if (isOp('+')) { p++; return unary() }
    return power()
  }
  function power(): Fn {
    const base = atom()
    if (!isOp('^')) return base
    p++
    const exp = unary() // right-associative, allows 2^-x
    return x => Math.pow(base(x), exp(x))
  }
  function atom(): Fn {
    const tk = tokens[p++]
    if (!tk) throw new Error('表达式不完整')
    if (tk.t === 'num') { const v = tk.v; return () => v }
    if (tk.t === 'op') {
      if (tk.v !== '(') throw new Error(`多余的“${tk.v}”`)
      const f = add(); expect(')'); return f
    }
    const name = tk.v
    if (isOp('(')) {
      const fn = FUNCTIONS[name.toLowerCase()]
      if (!fn) throw new Error(`不支持函数“${name}”`)
      p++
      const args: Fn[] = [add()]
      while (isOp(',')) { p++; args.push(add()) }
      expect(')')
      return x => fn(...args.map(a => a(x)))
    }
    if (vars.includes(name)) return x => x
    if (name in CONSTANTS) { const v = CONSTANTS[name]; return () => v }
    if (FUNCTIONS[name.toLowerCase()]) throw new Error(`函数“${name}”后需要括号`)
    throw new Error(`未知变量“${name}”，自变量请用 ${vars.join(' 或 ')}`)
  }

  const f = add()
  if (p < tokens.length) throw new Error(`多余的“${tokens[p].v}”`)
  return f
}

/** Evaluate a constant expression such as "2pi" or "-1.5"; empty string means unbounded. */
export function constValue(src: string): number | null {
  if (!src.trim()) return null
  return compileExpr(src, [])(0)
}


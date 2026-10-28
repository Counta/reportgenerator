/** Editable source of an XY plot. Coordinates are data units, never screen pixels. */
export type WaveKind = 'sin' | 'cos' | 'square' | 'triangle' | 'saw'
export type CurveKind = WaveKind | 'nodes' | 'data' | 'expr'
export type MarkerKind = 'circle' | 'square' | 'triangle' | 'none'
/** One piece of a piecewise function. Empty bounds are unbounded; the interval is [from, to). */
export interface ExprPiece {
  expr: string
  from: string
  to: string
}
export interface PlotNode {
  x: number
  y: number
  /** Connection from this node to the next one. */
  next: 'line' | 'hold' | 'break'
}
export interface PlotCurve {
  id: string
  name: string
  color: string
  dashed: boolean
  kind: CurveKind
  amplitude: number
  offset: number
  period: number
  /** Horizontal shift, in X units. */
  phase: number
  duty: number
  nodes: PlotNode[]
  /** Nodes describe a single cycle on [0, period], without symmetry constraints. */
  repeat?: boolean
  /** kind 'data': measured points live in `nodes` (their `next` is ignored), joined by straight lines in ascending X. */
  marker?: MarkerKind
  /** kind 'expr': pieces are evaluated in order; the first piece whose interval contains x wins. */
  pieces?: ExprPiece[]
}
export interface PlotDocument {
  version: 1
  title: string
  xLabel: string
  yLabel: string
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  grid: boolean
  /** Visibility of chart parts. Undefined means shown (charts saved before these options existed). */
  showTitle?: boolean
  showAxes?: boolean
  showNames?: boolean
  showLegend?: boolean
  /** Editor keeps the range fitted to the curves until the user zooms, pans or types a range. */
  autoRange?: boolean
  /** Render-only: text / line scale derived from the image's display width (1 = full width). */
  scale?: number
  /** Vertical jump markers vs disconnected segments with endpoint dots. */
  joinJumps: boolean
  curves: PlotCurve[]
}

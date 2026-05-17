// frontend/src/components/tracks/graph/marker-v2.ts

export const MARKER_LINE_V2 = '// @@ccweb-track-mode: graph v2'
export const NOTICE_LINE_V2 = '// 此文件由节点图编辑器生成；手改可能与 sidecar 元数据失同步。'

export const V1_MARKER_LINE = '// @@ccweb-track-mode: node-graph v1'

/** Format an nid comment line (single-line marker for non-CodeNode statements). */
export function nidComment(id: string, indent: string = '  '): string {
  return `${indent}// @@nid: ${id}`
}

/** Format CodeNode start/end markers. */
export function codeNodeStartComment(id: string, indent: string = '  '): string {
  return `${indent}// @@ccweb-node-start: ${id}`
}

export function codeNodeEndComment(id: string, indent: string = '  '): string {
  return `${indent}// @@ccweb-node-end: ${id}`
}

/** Detect track mode from .tr first line. */
export function detectTrackMode(source: string): 'graph-v2' | 'node-graph-v1' | 'code' {
  const firstLine = source.split('\n', 1)[0]?.trim() ?? ''
  if (firstLine === MARKER_LINE_V2) return 'graph-v2'
  if (firstLine === V1_MARKER_LINE) return 'node-graph-v1'
  return 'code'
}

/**
 * 扫描 .tr 源码中所有节点 marker，返回去重的 nid 集合。
 *
 * 扫描三种 marker（全部归一为同一 Set）：
 * - `// @@nid: n_xx` —— AskUser / Fai / Return 节点的单行 marker
 * - `// @@ccweb-node-start: n_xx` —— CodeNode 起始 marker
 * - `// @@ccweb-node-end: n_xx` —— CodeNode 结束 marker
 *
 * CodeNode 的 start 和 end 用同一 id，Set 自动去重。返回的 Set 表示
 * .tr 中存在 marker 的全部唯一节点 id，与 sidecar JSON 的 nodes[*].id 做 crossCheck。
 */
export function extractNidsFromSource(source: string): Set<string> {
  const result = new Set<string>()
  const re = /\/\/\s*@@(?:nid|ccweb-node-start|ccweb-node-end):\s*(n_[A-Za-z0-9_]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    if (m[1]) result.add(m[1])
  }
  return result
}

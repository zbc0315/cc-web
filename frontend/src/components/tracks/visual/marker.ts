// frontend/src/components/tracks/visual/marker.ts
export const MARKER_LINE = '// @@ccweb-track-mode: node-graph v1'
export const NOTICE_LINE = '// 文件由节点图编辑器生成。手改无效—请用节点图编辑。'

export function injectMarker(body: string): string {
  if (hasMarker(body)) return body
  return `${MARKER_LINE}\n${NOTICE_LINE}\n\n${body}`
}

export function hasMarker(source: string): boolean {
  return source.startsWith(MARKER_LINE)
}

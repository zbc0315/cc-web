import type { ChatMessage } from './websocket';

/** Convert chat message blocks to display text — text blocks only, tool use/result hidden */
export function formatChatContent(blocks: ChatMessage['blocks']): string {
  return blocks
    .filter(b => b.type === 'text')
    .map(b => b.content)
    .join('\n');
}

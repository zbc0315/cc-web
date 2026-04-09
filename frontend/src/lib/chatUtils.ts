import type { ChatMessage } from './websocket';

/** Convert chat message blocks to display text */
export function formatChatContent(blocks: ChatMessage['blocks']): string {
  return blocks
    .filter(b => b.type === 'text' || b.type === 'tool_use' || b.type === 'tool_result')
    .map(b => {
      if (b.type === 'tool_use') {
        const truncated = b.content.length > 60 ? b.content.slice(0, 60) + '...' : b.content;
        return `[工具] ${truncated}`;
      }
      if (b.type === 'tool_result') {
        const truncated = b.content.length > 80 ? b.content.slice(0, 80) + '...' : b.content;
        return `→ ${truncated}`;
      }
      return b.content;
    })
    .join('\n');
}

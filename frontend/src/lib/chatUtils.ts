import type { ChatMessage } from './websocket';

/**
 * Convert chat message blocks to displayable markdown.
 * - text  → raw content
 * - thinking / tool_use / tool_result → fenced code block with type as language tag
 *   so AssistantMessageContent can style them (folding / custom rendering by lang).
 * Previously this dropped non-text blocks entirely — users couldn't see tool calls
 * or thinking, even though the JSONL had them.
 */
export function formatChatContent(blocks: ChatMessage['blocks']): string {
  return blocks
    .map(b => (b.type === 'text' ? b.content : `\n\`\`\`${b.type}\n${b.content}\n\`\`\`\n`))
    .join('');
}

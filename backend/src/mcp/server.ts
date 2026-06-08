/**
 * Entry point for `ccweb mcp` — a stdio MCP server that proxies calls to the
 * running ccweb daemon on the same host.
 *
 * Why a separate process: MCP clients (Claude Code / Codex / Cursor) launch
 * the server as a stdio child. Keeping it out of the daemon means:
 *   - daemon never needs to be MCP-aware
 *   - server lifecycle = MCP client lifecycle (clean shutdown when client exits)
 *   - one daemon serves multiple concurrent MCP clients without contention
 *
 * stdout is reserved for the MCP JSON-RPC framing. All diagnostics MUST go
 * to stderr (console.error). console.log would corrupt the protocol stream.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'ccweb',
    version: '1.0.0',
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[ccweb-mcp] ready (stdio)');
}

main().catch((err) => {
  console.error('[ccweb-mcp] fatal:', err);
  process.exit(1);
});

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toolErrorMessage } from './errors';
import { listGearSets, listImplants } from './tools/gear';
import { getShip, searchShips } from './tools/ships';
import { McpToolError, defineTool, type McpToolContext, type RegisteredMcpTool } from './types';

/** Every tool the MCP server offers. All of them only read. */
export const TOOLS: readonly RegisteredMcpTool[] = [
    defineTool(searchShips),
    defineTool(getShip),
    defineTool(listGearSets),
    defineTool(listImplants),
];

/**
 * Registers `tools` on `server`, each bound to `ctx`. The SDK validates a call's arguments against
 * the tool's `input` and answers a failure itself (`isError: true`). A tool that throws is
 * answered with `toolErrorMessage`; anything but an `McpToolError` is also logged in full, to the
 * function log only.
 */
export function registerTools(
    server: McpServer,
    ctx: McpToolContext,
    tools: readonly RegisteredMcpTool[] = TOOLS
): void {
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            {
                description: tool.description,
                inputSchema: tool.input,
                annotations: { readOnlyHint: true },
            },
            async (input) => {
                try {
                    const result = await tool.run(input, ctx);
                    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
                } catch (error) {
                    if (!(error instanceof McpToolError)) {
                        console.error(`MCP tool ${tool.name} failed:`, error);
                    }
                    return {
                        content: [{ type: 'text', text: toolErrorMessage(error) }],
                        isError: true,
                    };
                }
            }
        );
    }
}

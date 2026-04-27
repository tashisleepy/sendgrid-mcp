#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { SendGridService } from "./services/sendgrid.js";
import { getToolDefinitions, handleToolCall } from "./tools/index.js";

// Initialize SendGrid with API key from environment variable
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
if (!SENDGRID_API_KEY) {
  throw new Error('SENDGRID_API_KEY environment variable is required');
}

// Initialize the SendGrid service
const sendGridService = new SendGridService(SENDGRID_API_KEY);

const server = new Server(
  {
    name: "sendgrid-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Handler that lists available tools.
 * Exposes all SendGrid API capabilities as tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: getToolDefinitions()
  };
});

/**
 * Handler for tool calls.
 * Routes each tool call to the appropriate SendGrid service method.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    return await handleToolCall(sendGridService, request.params.name, request.params.arguments);
  } catch (error: any) {
    // Sanitize before logging: axios errors carry error.config.headers (Authorization
    // bearer token = SendGrid API key) and error.response.body (recipient PII).
    // Logging the raw error object would leak both to stderr.
    console.error('SendGrid Error:', {
      message: error?.message,
      status: error?.response?.statusCode ?? error?.code,
      errors: error?.response?.body?.errors?.map((e: { message: string }) => e.message),
    });

    // Handle SendGrid API errors
    if (error.response?.body?.errors) {
      throw new McpError(
        ErrorCode.InternalError,
        `SendGrid API Error: ${error.response.body.errors.map((e: { message: string }) => e.message).join(', ')}`
      );
    }

    // Handle other errors
    if (error instanceof Error) {
      throw new McpError(
        ErrorCode.InternalError,
        error.message
      );
    }

    throw new McpError(ErrorCode.InternalError, 'An unexpected error occurred');
  }
});

/**
 * Start the server using stdio transport.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('SendGrid MCP server running on stdio');
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

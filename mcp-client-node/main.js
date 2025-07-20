import { ClientSession, stdioClient, StdioServerParameters } from 'mcp-client';
import { Anthropic } from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

class MCPClient {
  constructor() {
    this.session = null;
    this.stdio = null;
    this.write = null;
    this.anthropic = new Anthropic();
  }

  async connectToServer(serverScriptPath) {
    const isPython = serverScriptPath.endsWith('.py');
    const isJs = serverScriptPath.endsWith('.js');
    if (!isPython && !isJs) {
      throw new Error('Server script must be a .py or .js file');
    }

    const command = isPython ? 'python' : 'node';
    const serverParams = new StdioServerParameters({
      command,
      args: [serverScriptPath],
      env: null
    });

    const { stdio, write } = await stdioClient(serverParams);
    this.stdio = stdio;
    this.write = write;
    this.session = new ClientSession(stdio, write);

    await this.session.initialize();
    const response = await this.session.listTools();
    const tools = response.tools;
    console.log('\nConnected to server with tools:', tools.map(t => t.name));
  }

  async processQuery(query) {
    const messages = [{ role: 'user', content: query }];

    const response = await this.session.listTools();
    const availableTools = response.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));

    let aiResponse = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages,
      tools: availableTools
    });

    const finalText = [];
    let assistantMessageContent = [];

    for (const content of aiResponse.content) {
      if (content.type === 'text') {
        finalText.push(content.text);
        assistantMessageContent.push(content);
      } else if (content.type === 'tool_use') {
        const toolName = content.name;
        const toolArgs = content.input;

        const result = await this.session.callTool(toolName, toolArgs);
        finalText.push(`[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`);

        assistantMessageContent.push(content);
        messages.push({ role: 'assistant', content: assistantMessageContent });
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: content.id,
            content: result.content
          }]
        });

        aiResponse = await this.anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1000,
          messages,
          tools: availableTools
        });

        finalText.push(aiResponse.content[0].text);
      }
    }

    return finalText.join('\n');
  }

  async cleanup() {
    if (this.session) {
      await this.session.close();
    }
  }
}

async function main() {
  const client = new MCPClient();
  try {
    await client.connectToServer('pathtoserver');
    console.log(await client.processQuery('List me transactions of Şok Market'));
  } finally {
    await client.cleanup();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

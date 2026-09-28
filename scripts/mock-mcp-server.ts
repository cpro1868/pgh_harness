import readline from 'node:readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed);
    const { id, method, params } = req;

    if (method === 'initialize') {
      const resp = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-math-server', version: '0.1.0' },
        },
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
      return;
    }

    if (method === 'tools/list') {
      const resp = {
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'add',
              description: 'Add two numbers: a + b',
              inputSchema: {
                type: 'object',
                properties: {
                  a: { type: 'number', description: 'First number' },
                  b: { type: 'number', description: 'Second number' },
                },
                required: ['a', 'b'],
              },
            },
            {
              name: 'echo',
              description: 'Echo back the input message with timestamp',
              inputSchema: {
                type: 'object',
                properties: {
                  message: { type: 'string', description: 'Message to echo' },
                },
                required: ['message'],
              },
            },
          ],
        },
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
      return;
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      let textResult = '';
      if (name === 'add') {
        const sum = Number(args?.a ?? 0) + Number(args?.b ?? 0);
        textResult = `Result: ${sum}`;
      } else if (name === 'echo') {
        textResult = `[Echo ${new Date().toISOString()}] ${args?.message ?? ''}`;
      } else {
        const resp = {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Tool not found: ${name}` },
        };
        process.stdout.write(JSON.stringify(resp) + '\n');
        return;
      }

      const resp = {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: textResult }],
        },
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
      return;
    }

    // fallback
    const resp = {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
    process.stdout.write(JSON.stringify(resp) + '\n');
  } catch (err) {
    // 忽略非 JSON 行
  }
});

import { LLMService } from '../../src/services/LLMService.js';
import fs from 'fs';
import path from 'path';

function createStreamingResponse(lines: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: {
      get: () => 'text/event-stream',
    },
    body: {
      getReader() {
        return {
          async read() {
            if (index >= lines.length) {
              return { done: true, value: undefined };
            }
            const value = encoder.encode(lines[index]);
            index += 1;
            return { done: false, value };
          },
          async cancel() {
            return undefined;
          },
        };
      },
    },
  };
}

describe('LLMService OpenAI Responses integration', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('uses the Responses API with configured reasoning and verbosity controls', async () => {
    const llm = new LLMService({
      provider: 'openai',
      openai: {
        apiKey: 'test-key',
        model: 'gpt-5.4',
        baseURL: 'https://ai.changyou.club/v1',
        wireApi: 'responses',
        reasoningEffort: 'high',
        reasoningSummary: 'none',
        verbosity: 'low',
        disableResponseStorage: true,
        contextWindow: 1_050_000,
      },
      anthropic: {
        apiKey: '',
        model: 'claude-3-5-sonnet-20241022',
      },
    });

    const fetchMock = jest.fn().mockResolvedValue(createStreamingResponse([
      ': ping\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"OK"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"OK"}]}],"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}\n\n',
    ]));
    global.fetch = fetchMock as typeof global.fetch;

    const result = await llm.chat([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ], {
      temperature: 0.2,
      maxTokens: 120,
    });

    expect(result.content).toBe('OK');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      model: 'gpt-5.4',
      store: false,
      stream: true,
      max_output_tokens: 120,
      reasoning: {
        effort: 'high',
      },
      text: {
        verbosity: 'low',
      },
    });
    expect(body.reasoning.summary).toBeUndefined();
  });

  test('uses Responses API image inputs for OpenAI vision analysis', async () => {
    const llm = new LLMService({
      provider: 'openai',
      openai: {
        apiKey: 'test-key',
        model: 'gpt-5.4',
        baseURL: 'https://ai.changyou.club/v1',
        wireApi: 'responses',
        reasoningEffort: 'high',
        reasoningSummary: 'none',
        verbosity: 'low',
        disableResponseStorage: true,
      },
      anthropic: {
        apiKey: '',
        model: 'claude-3-5-sonnet-20241022',
      },
    });

    const fetchMock = jest.fn().mockResolvedValue(createStreamingResponse([
      ': ping\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"vision-ok"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"vision-ok"}]}],"usage":{"input_tokens":8,"output_tokens":4,"total_tokens":12}}}\n\n',
    ]));
    global.fetch = fetchMock as typeof global.fetch;

    const result = await llm.analyzeImage('BASE64DATA', 'describe the image');

    expect(result).toBe('vision-ok');
    const [, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      model: 'gpt-5.4',
      store: false,
      stream: true,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'describe the image' },
            { type: 'input_image', image_url: 'data:image/png;base64,BASE64DATA' },
          ],
        },
      ],
    });
  });
});

describe('custom OpenAI provider defaults', () => {
  test('documents the custom Responses endpoint and gpt-5.4 profile in env defaults', () => {
    const envExample = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf-8');

    expect(envExample).toContain('OPENAI_MODEL=gpt-5.4');
    expect(envExample).toContain('OPENAI_BASE_URL=https://ai.changyou.club/v1');
    expect(envExample).toContain('OPENAI_WIRE_API=responses');
    expect(envExample).toContain('OPENAI_REASONING_EFFORT=high');
    expect(envExample).toContain('OPENAI_REASONING_SUMMARY=none');
    expect(envExample).toContain('OPENAI_VERBOSITY=low');
    expect(envExample).toContain('OPENAI_CONTEXT_WINDOW=1050000');
    expect(envExample).toContain('OPENAI_DISABLE_RESPONSE_STORAGE=true');
  });
});

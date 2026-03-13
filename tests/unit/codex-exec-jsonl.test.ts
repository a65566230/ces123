import { parseCodexExecJsonl } from '../../src/server/v2/tools/codexExecJsonl.js';

describe('parseCodexExecJsonl', () => {
  test('extracts the final agent message and usage block', () => {
    const parsed = parseCodexExecJsonl([
      '{"type":"thread.started","thread_id":"thread-1"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"{\\"success\\":true}"}}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}',
    ].join('\n'));

    expect(parsed.threadId).toBe('thread-1');
    expect(parsed.finalText).toBe('{"success":true}');
    expect(parsed.usage).toEqual({
      input_tokens: 10,
      output_tokens: 5,
    });
  });
});

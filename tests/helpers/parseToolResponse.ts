export function parseToolResponse(response: {
  content: Array<{ type: string; text: string }>;
}): Record<string, unknown> {
  const text = response.content.find((item) => item.type === 'text')?.text;
  if (!text) {
    throw new Error('Tool response did not contain a text payload');
  }

  return JSON.parse(text) as Record<string, unknown>;
}

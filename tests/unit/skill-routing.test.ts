import fs from 'fs';
import path from 'path';
import { V2_TOOL_CATALOG } from '../../src/server/v2/tools/createV2Tools.js';

const repoRoot = process.cwd();
const v2ToolNames = new Set(V2_TOOL_CATALOG.map((tool) => tool.name));
const allowedGroupWildcards = new Set([
  'browser.*',
  'inspect.*',
  'debug.*',
  'analyze.*',
  'hook.*',
  'flow.*',
]);

function extractToolReferences(raw: string): string[] {
  const matches = raw.match(/`([a-z]+(?:\.[a-z*][a-z0-9-]*)+)`/g) || [];
  return matches
    .map((match) => match.slice(1, -1))
    .filter((reference) => /^(browser|inspect|debug|analyze|hook|flow)\./.test(reference));
}

function findInvalidReferences(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  return extractToolReferences(raw).filter((reference) => {
    if (v2ToolNames.has(reference)) {
      return false;
    }

    if (allowedGroupWildcards.has(reference)) {
      return false;
    }

    return true;
  });
}

describe('skill routing docs', () => {
  test('do not reference nonexistent v2 tool names', () => {
    const files = [
      path.join(repoRoot, 'skills', 'jshook-reverse-operator', 'SKILL.md'),
      path.join(repoRoot, 'skills', 'jshook-reverse-operator', 'references', 'tool-routing.md'),
      path.join(repoRoot, 'skills', 'jshook-reverse-operator', 'references', 'playbooks.md'),
      path.join(repoRoot, 'skills', 'jshook-reverse-quickstart', 'SKILL.md'),
      path.join(repoRoot, 'skills', 'jshook-reverse-quickstart', 'references', 'tool-routing.md'),
      path.join(repoRoot, 'skills', 'jshook-reverse-quickstart', 'references', 'playbooks.md'),
    ];

    const invalidByFile = files.map((filePath) => ({
      filePath,
      invalid: findInvalidReferences(filePath),
    }));

    expect(invalidByFile).toEqual([
      {
        filePath: files[0],
        invalid: [],
      },
      {
        filePath: files[1],
        invalid: [],
      },
      {
        filePath: files[2],
        invalid: [],
      },
      {
        filePath: files[3],
        invalid: [],
      },
      {
        filePath: files[4],
        invalid: [],
      },
      {
        filePath: files[5],
        invalid: [],
      },
    ]);
  });
});

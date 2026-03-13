import fs from 'fs';
import path from 'path';
import { V2_TOOL_CATALOG } from '../src/server/v2/tools/createV2Tools.js';

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
const skillConfigs = [
  {
    id: 'jshook-reverse-operator',
    root: path.join(repoRoot, 'skills', 'jshook-reverse-operator'),
    requiredFiles: [
      'SKILL.md',
      path.join('agents', 'openai.yaml'),
      path.join('references', 'tool-routing.md'),
      path.join('references', 'playbooks.md'),
      path.join('scripts', 'render_reverse_report.py'),
    ],
    displayName: 'JSHook Reverse Operator',
    defaultPromptPrefix: 'default_prompt: "Use $jshook-reverse-operator',
    requiredEntrypoints: ['flow.collect-site', 'flow.reverse-report'],
  },
  {
    id: 'jshook-reverse-quickstart',
    root: path.join(repoRoot, 'skills', 'jshook-reverse-quickstart'),
    requiredFiles: [
      'SKILL.md',
      path.join('agents', 'openai.yaml'),
      path.join('references', 'tool-routing.md'),
      path.join('references', 'playbooks.md'),
    ],
    displayName: 'JSHook Reverse Quickstart',
    defaultPromptPrefix: 'default_prompt: "Use $jshook-reverse-quickstart',
    requiredEntrypoints: ['flow.collect-site', 'flow.find-signature-path', 'flow.resume-session'],
  },
] as const;

function readFile(skillRoot: string, relativePath: string): string {
  return fs.readFileSync(path.join(skillRoot, relativePath), 'utf8');
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function extractToolReferences(raw: string): string[] {
  const matches = raw.match(/`([a-z]+(?:\.[a-z*][a-z0-9-]*)+)`/g) || [];
  return matches
    .map((match) => match.slice(1, -1))
    .filter((reference) => /^(browser|inspect|debug|analyze|hook|flow)\./.test(reference));
}

function validateToolReferences(skillRoot: string, relativePath: string): void {
  const raw = readFile(skillRoot, relativePath);
  const invalid = extractToolReferences(raw).filter((reference) => {
    if (v2ToolNames.has(reference)) {
      return false;
    }

    return !allowedGroupWildcards.has(reference);
  });

  assert(
    invalid.length === 0,
    `${path.relative(repoRoot, path.join(skillRoot, relativePath))} references unknown v2 tool names: ${invalid.join(', ')}`,
  );
}

function extractFrontmatterField(frontmatter: string, field: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
}

function validateSkillMarkdown(skill: (typeof skillConfigs)[number]): void {
  const raw = readFile(skill.root, 'SKILL.md');
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert(frontmatterMatch, 'SKILL.md must include YAML frontmatter');

  const frontmatter = frontmatterMatch![1];
  const name = extractFrontmatterField(frontmatter, 'name');
  const description = extractFrontmatterField(frontmatter, 'description');
  assert(name === skill.id, `SKILL.md frontmatter name must be ${skill.id}`);
  assert(description && !description.includes('TODO'), 'SKILL.md description must be completed');
  assert(!raw.includes('[TODO:'), 'SKILL.md must not contain unresolved TODO markers');
  for (const entrypoint of skill.requiredEntrypoints) {
    assert(raw.includes(entrypoint), `SKILL.md should guide the ${entrypoint} entrypoint`);
  }
}

function validateOpenAIYaml(skill: (typeof skillConfigs)[number]): void {
  const raw = readFile(skill.root, path.join('agents', 'openai.yaml'));
  assert(raw.includes(`display_name: "${skill.displayName}"`), 'agents/openai.yaml must define the display name');
  assert(raw.includes(skill.defaultPromptPrefix), 'agents/openai.yaml default prompt must reference the skill');
}

function validateReferences(skill: (typeof skillConfigs)[number]): void {
  const routing = readFile(skill.root, path.join('references', 'tool-routing.md'));
  const playbooks = readFile(skill.root, path.join('references', 'playbooks.md'));
  assert(routing.includes('flow.collect-site'), 'tool-routing.md must mention flow.collect-site');
  assert(playbooks.length > 0, 'playbooks.md must not be empty');
  validateToolReferences(skill.root, 'SKILL.md');
  validateToolReferences(skill.root, path.join('references', 'tool-routing.md'));
  validateToolReferences(skill.root, path.join('references', 'playbooks.md'));
}

function main(): void {
  for (const skill of skillConfigs) {
    assert(fs.existsSync(skill.root), `${path.relative(repoRoot, skill.root)} directory is missing`);

    for (const relativePath of skill.requiredFiles) {
      assert(fs.existsSync(path.join(skill.root, relativePath)), `Missing required skill file: ${path.join(path.relative(repoRoot, skill.root), relativePath)}`);
    }

    validateSkillMarkdown(skill);
    validateOpenAIYaml(skill);
    validateReferences(skill);
  }

  console.log('Skill validation passed');
}

main();

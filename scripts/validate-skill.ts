import fs from 'fs';
import path from 'path';

const repoRoot = process.cwd();
const skillRoot = path.join(repoRoot, 'skills', 'jshook-reverse-operator');
const requiredFiles = [
  'SKILL.md',
  path.join('agents', 'openai.yaml'),
  path.join('references', 'tool-routing.md'),
  path.join('references', 'playbooks.md'),
  path.join('scripts', 'render_reverse_report.py'),
];

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(skillRoot, relativePath), 'utf8');
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function extractFrontmatterField(frontmatter: string, field: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
}

function validateSkillMarkdown(): void {
  const raw = readFile('SKILL.md');
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  assert(frontmatterMatch, 'SKILL.md must include YAML frontmatter');

  const frontmatter = frontmatterMatch![1];
  const name = extractFrontmatterField(frontmatter, 'name');
  const description = extractFrontmatterField(frontmatter, 'description');
  assert(name === 'jshook-reverse-operator', 'SKILL.md frontmatter name must be jshook-reverse-operator');
  assert(description && !description.includes('TODO'), 'SKILL.md description must be completed');
  assert(!raw.includes('[TODO:'), 'SKILL.md must not contain unresolved TODO markers');
  assert(raw.includes('flow.collect-site'), 'SKILL.md should guide the primary flow.collect-site entrypoint');
  assert(raw.includes('flow.reverse-report'), 'SKILL.md should guide the flow.reverse-report entrypoint');
}

function validateOpenAIYaml(): void {
  const raw = readFile(path.join('agents', 'openai.yaml'));
  assert(raw.includes('display_name: "JSHook Reverse Operator"'), 'agents/openai.yaml must define the display name');
  assert(raw.includes('default_prompt: "Use $jshook-reverse-operator'), 'agents/openai.yaml default prompt must reference the skill');
}

function validateReferences(): void {
  const routing = readFile(path.join('references', 'tool-routing.md'));
  const playbooks = readFile(path.join('references', 'playbooks.md'));
  assert(routing.includes('flow.collect-site'), 'tool-routing.md must mention flow.collect-site');
  assert(routing.includes('ENABLE_LEGACY_TOOLS=true'), 'tool-routing.md must document legacy alias usage');
  assert(playbooks.includes('Reverse report'), 'playbooks.md must describe reverse report generation');
}

function main(): void {
  assert(fs.existsSync(skillRoot), 'skills/jshook-reverse-operator directory is missing');

  for (const relativePath of requiredFiles) {
    assert(fs.existsSync(path.join(skillRoot, relativePath)), `Missing required skill file: ${relativePath}`);
  }

  validateSkillMarkdown();
  validateOpenAIYaml();
  validateReferences();

  console.log('Skill validation passed');
}

main();

// @ts-nocheck

import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

const traverseAst = traverse.default || traverse;
const generateCode = generate.default || generate;

export class FunctionRanker {
  public rank(code) {
    const ast = parser.parse(String(code || ''), {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx'],
    });
    const ranked = [];

    const inspectNode = (node, name) => {
      const fullCode = generateCode(node).code;
      const preview = fullCode.slice(0, 240);
      const reasons = [];
      let score = 0;

      for (const [pattern, reason, weight] of [
        [/sign|signature|token|nonce|timestamp/i, 'request-signing-keywords', 5],
        [/crypto|encrypt|decrypt|hmac|sha|md5/i, 'crypto-keywords', 5],
        [/fetch|xmlhttprequest|authorization|headers/i, 'network-keywords', 4],
      ]) {
        if (pattern.test(preview)) {
          reasons.push(reason);
          score += weight;
        }
      }

      for (const [pattern, reason, weight] of [
        [/\beval\b/i, 'dynamic-execution', 2],
        [/\bFunction\s*\(/, 'dynamic-execution', 2],
      ]) {
        if (pattern.test(fullCode)) {
          reasons.push(reason);
          score += weight;
        }
      }

      const parameterCount = Array.isArray(node.params) ? node.params.length : 0;
      if (parameterCount >= 2) {
        reasons.push('multi-parameter-flow');
        score += 1;
      }

      if (/\{[\s\S]{0,240}:\s*/.test(fullCode)) {
        reasons.push('object-assembly');
        score += 2;
      }

      if (/\.\w+\s*=|\[['"][^'"]+['"]\]\s*=/.test(fullCode)) {
        reasons.push('property-write-adjacent');
        score += 2;
      }

      if (/btoa|atob|JSON\.stringify|TextEncoder|Uint8Array|Buffer\.from|crypto\.subtle/i.test(fullCode)) {
        reasons.push('encoding-transform');
        score += 2;
      }

      if (preview.length > 180) {
        reasons.push('large-function-body');
        score += 1;
      }

      return {
        name,
        line: node.loc?.start.line || 0,
        score,
        reasons,
        preview,
      };
    };

    traverseAst(ast, {
      FunctionDeclaration: (path) => {
        ranked.push(inspectNode(path.node, path.node.id?.name || 'anonymous'));
      },
      FunctionExpression: (path) => {
        const parent = path.parent;
        const name = parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier'
          ? parent.id.name
          : 'anonymous';
        ranked.push(inspectNode(path.node, name));
      },
      ArrowFunctionExpression: (path) => {
        const parent = path.parent;
        const name = parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier'
          ? parent.id.name
          : 'arrow';
        ranked.push(inspectNode(path.node, name));
      },
      ObjectMethod: (path) => {
        const key = path.node.key;
        const name = t.isIdentifier(key) ? key.name : t.isStringLiteral(key) ? key.value : 'object-method';
        ranked.push(inspectNode(path.node, name));
      },
    });

    return ranked
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 20);
  }
}

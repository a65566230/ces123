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
      const preview = generateCode(node).code.slice(0, 240);
      const reasons = [];
      let score = 0;

      for (const [pattern, reason, weight] of [
        [/sign|signature|token|nonce|timestamp/i, 'request-signing-keywords', 5],
        [/crypto|encrypt|decrypt|hmac|sha|md5/i, 'crypto-keywords', 5],
        [/fetch|xmlhttprequest|authorization|headers/i, 'network-keywords', 4],
        [/eval|Function\(/i, 'dynamic-execution', 2],
      ]) {
        if (pattern.test(preview)) {
          reasons.push(reason);
          score += weight;
        }
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

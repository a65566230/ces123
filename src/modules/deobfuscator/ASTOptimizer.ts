// @ts-nocheck

import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { logger } from '../../utils/logger.js';
export class ASTOptimizer {
    optimize(code) {
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            for (let i = 0; i < 3; i++) {
                logger.debug(`AST optimization pass ${i + 1}`);
                this.constantFolding(ast);
                this.constantPropagation(ast);
                this.deadCodeElimination(ast);
                this.expressionSimplification(ast);
                this.variableInlining(ast);
                this.objectPropertyUnfolding(ast);
                this.computedPropertyResolution(ast);
                this.sequenceExpressionExpansion(ast);
            }
            const output = generate(ast, {
                comments: false,
                compact: false,
            });
            return output.code;
        }
        catch (error) {
            logger.error('AST optimization failed', error);
            return code;
        }
    }
    constantFolding(ast) {
        traverse(ast, {
            BinaryExpression(path) {
                const { left, right, operator } = path.node;
                if (t.isNumericLiteral(left) && t.isNumericLiteral(right)) {
                    let result;
                    switch (operator) {
                        case '+':
                            result = left.value + right.value;
                            break;
                        case '-':
                            result = left.value - right.value;
                            break;
                        case '*':
                            result = left.value * right.value;
                            break;
                        case '/':
                            result = left.value / right.value;
                            break;
                        case '%':
                            result = left.value % right.value;
                            break;
                        case '**':
                            result = left.value ** right.value;
                            break;
                        default:
                            return;
                    }
                    path.replaceWith(t.numericLiteral(result));
                }
                if (t.isStringLiteral(left) && t.isStringLiteral(right) && operator === '+') {
                    path.replaceWith(t.stringLiteral(left.value + right.value));
                }
            },
            UnaryExpression(path) {
                const { argument, operator } = path.node;
                if (t.isNumericLiteral(argument)) {
                    if (operator === '-') {
                        path.replaceWith(t.numericLiteral(-argument.value));
                    }
                    else if (operator === '+') {
                        path.replaceWith(t.numericLiteral(argument.value));
                    }
                    else if (operator === '!') {
                        path.replaceWith(t.booleanLiteral(!argument.value));
                    }
                }
                if (t.isBooleanLiteral(argument) && operator === '!') {
                    path.replaceWith(t.booleanLiteral(!argument.value));
                }
            },
        });
    }
    constantPropagation(ast) {
        const constants = new Map();
        traverse(ast, {
            VariableDeclarator(path) {
                const { id, init } = path.node;
                if (t.isIdentifier(id) && init && t.isLiteral(init)) {
                    constants.set(id.name, init);
                }
            },
            Identifier(path) {
                const name = path.node.name;
                const constant = constants.get(name);
                if (constant && !path.isBindingIdentifier()) {
                    path.replaceWith(t.cloneNode(constant));
                }
            },
        });
    }
    deadCodeElimination(ast) {
        traverse(ast, {
            IfStatement(path) {
                const { test, consequent, alternate } = path.node;
                if (t.isBooleanLiteral(test)) {
                    if (test.value) {
                        path.replaceWith(consequent);
                    }
                    else {
                        if (alternate) {
                            path.replaceWith(alternate);
                        }
                        else {
                            path.remove();
                        }
                    }
                }
            },
            ConditionalExpression(path) {
                const { test, consequent, alternate } = path.node;
                if (t.isBooleanLiteral(test)) {
                    path.replaceWith(test.value ? consequent : alternate);
                }
            },
            LogicalExpression(path) {
                const { left, right, operator } = path.node;
                if (t.isBooleanLiteral(left)) {
                    if (operator === '&&') {
                        path.replaceWith(left.value ? right : left);
                    }
                    else if (operator === '||') {
                        path.replaceWith(left.value ? left : right);
                    }
                }
            },
        });
    }
    expressionSimplification(ast) {
        traverse(ast, {
            BinaryExpression(path) {
                const { left, right, operator } = path.node;
                if (operator === '+' && t.isNumericLiteral(right) && right.value === 0) {
                    path.replaceWith(left);
                }
                if (operator === '*' && t.isNumericLiteral(right) && right.value === 1) {
                    path.replaceWith(left);
                }
                if (operator === '*' && t.isNumericLiteral(right) && right.value === 0) {
                    path.replaceWith(t.numericLiteral(0));
                }
            },
            UnaryExpression(path) {
                const { argument, operator } = path.node;
                if (operator === '!' &&
                    t.isUnaryExpression(argument) &&
                    argument.operator === '!') {
                    path.replaceWith(t.callExpression(t.identifier('Boolean'), [argument.argument]));
                }
            },
        });
    }
    variableInlining(ast) {
        const inlineCandidates = new Map();
        traverse(ast, {
            VariableDeclarator(path) {
                const { id, init } = path.node;
                if (t.isIdentifier(id) && init && t.isLiteral(init)) {
                    inlineCandidates.set(id.name, { value: init, usageCount: 0 });
                }
            },
            Identifier(path) {
                const name = path.node.name;
                const candidate = inlineCandidates.get(name);
                if (candidate && !path.isBindingIdentifier()) {
                    candidate.usageCount++;
                }
            },
        });
        traverse(ast, {
            Identifier(path) {
                const name = path.node.name;
                const candidate = inlineCandidates.get(name);
                if (candidate && candidate.usageCount <= 3 && !path.isBindingIdentifier()) {
                    path.replaceWith(t.cloneNode(candidate.value));
                }
            },
        });
    }
    objectPropertyUnfolding(ast) {
        traverse(ast, {
            MemberExpression(path) {
                const { object, property, computed } = path.node;
                if (computed && t.isStringLiteral(property)) {
                    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(property.value)) {
                        path.replaceWith(t.memberExpression(object, t.identifier(property.value), false));
                    }
                }
            },
        });
    }
    computedPropertyResolution(ast) {
        traverse(ast, {
            ObjectProperty(path) {
                const { key, computed } = path.node;
                if (computed && t.isStringLiteral(key)) {
                    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key.value)) {
                        path.node.computed = false;
                        path.node.key = t.identifier(key.value);
                    }
                }
            },
        });
    }
    sequenceExpressionExpansion(ast) {
        traverse(ast, {
            SequenceExpression(path) {
                const { expressions } = path.node;
                if (expressions.length === 1 && expressions[0]) {
                    path.replaceWith(expressions[0]);
                }
                if (path.parentPath.isExpressionStatement()) {
                    const statements = expressions.map((expr) => t.expressionStatement(expr));
                    path.parentPath.replaceWithMultiple(statements);
                }
            },
        });
    }
}
//# sourceMappingURL=ASTOptimizer.js.map
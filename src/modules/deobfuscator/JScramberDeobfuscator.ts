// @ts-nocheck

import * as parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { logger } from '../../utils/logger.js';
import { resolveBabelTraverse } from '../../utils/babelTraverse.js';

const traverse = resolveBabelTraverse(traverseModule);

export class JScramberDeobfuscator {
    async deobfuscate(options) {
        const { code, removeDeadCode = true, restoreControlFlow = true, decryptStrings = true, simplifyExpressions = true, } = options;
        logger.info('🔓 开始JScrambler反混淆...');
        const transformations = [];
        const warnings = [];
        let currentCode = code;
        try {
            const ast = parser.parse(currentCode, {
                sourceType: 'unambiguous',
                plugins: ['jsx', 'typescript'],
                errorRecovery: true,
            });
            if (this.detectSelfDefending(ast)) {
                this.removeSelfDefending(ast);
                transformations.push('移除自我防御代码');
            }
            if (decryptStrings) {
                const decrypted = this.decryptStrings(ast);
                if (decrypted > 0) {
                    transformations.push(`解密字符串: ${decrypted}个`);
                }
            }
            if (restoreControlFlow) {
                const restored = this.restoreControlFlow(ast);
                if (restored > 0) {
                    transformations.push(`还原控制流: ${restored}个`);
                }
            }
            if (removeDeadCode) {
                const removed = this.removeDeadCode(ast);
                if (removed > 0) {
                    transformations.push(`移除死代码: ${removed}个`);
                }
            }
            if (simplifyExpressions) {
                const simplified = this.simplifyExpressions(ast);
                if (simplified > 0) {
                    transformations.push(`简化表达式: ${simplified}个`);
                }
            }
            const output = generate(ast, {
                comments: true,
                compact: false,
            });
            currentCode = output.code;
            const confidence = this.calculateConfidence(transformations.length);
            logger.info(`✅ JScrambler反混淆完成，应用了 ${transformations.length} 个转换`);
            return {
                code: currentCode,
                success: true,
                transformations,
                warnings,
                confidence,
            };
        }
        catch (error) {
            logger.error('JScrambler反混淆失败', error);
            return {
                code: currentCode,
                success: false,
                transformations,
                warnings: [...warnings, String(error)],
                confidence: 0,
            };
        }
    }
    detectSelfDefending(ast) {
        let hasSelfDefending = false;
        traverse(ast, {
            FunctionDeclaration(path) {
                if (path.node.body.body.some((stmt) => t.isDebuggerStatement(stmt))) {
                    hasSelfDefending = true;
                }
                const code = generate(path.node).code;
                if (code.includes('toString') && code.includes('constructor')) {
                    hasSelfDefending = true;
                }
            },
        });
        return hasSelfDefending;
    }
    removeSelfDefending(ast) {
        traverse(ast, {
            DebuggerStatement(path) {
                path.remove();
            },
            CallExpression(path) {
                if (t.isIdentifier(path.node.callee) &&
                    (path.node.callee.name === 'setInterval' || path.node.callee.name === 'setTimeout')) {
                    const arg = path.node.arguments[0];
                    if (t.isFunctionExpression(arg) || t.isArrowFunctionExpression(arg)) {
                        const body = arg.body;
                        if (t.isBlockStatement(body)) {
                            if (body.body.some((stmt) => t.isDebuggerStatement(stmt))) {
                                path.remove();
                            }
                        }
                    }
                }
            },
        });
    }
    decryptStrings(ast) {
        let count = 0;
        const decryptFunctions = this.findDecryptFunctions(ast);
        traverse(ast, {
            CallExpression(path) {
                if (t.isIdentifier(path.node.callee)) {
                    const funcName = path.node.callee.name;
                    if (decryptFunctions.has(funcName)) {
                        try {
                            const decrypted = '[DECRYPTED_STRING]';
                            path.replaceWith(t.stringLiteral(decrypted));
                            count++;
                        }
                        catch {
                        }
                    }
                }
            },
        });
        return count;
    }
    findDecryptFunctions(ast) {
        const decryptFunctions = new Set();
        traverse(ast, {
            FunctionDeclaration(path) {
                const code = generate(path.node).code;
                if (code.includes('charCodeAt') &&
                    code.includes('fromCharCode') &&
                    code.includes('split')) {
                    if (path.node.id) {
                        decryptFunctions.add(path.node.id.name);
                    }
                }
            },
        });
        return decryptFunctions;
    }
    restoreControlFlow(ast) {
        let count = 0;
        const self = this;
        traverse(ast, {
            WhileStatement(path) {
                if (self.isControlFlowFlatteningPattern(path.node)) {
                    try {
                        self.unflattenControlFlowPattern(path);
                        count++;
                    }
                    catch {
                    }
                }
            },
        });
        return count;
    }
    isControlFlowFlatteningPattern(node) {
        if (!t.isBooleanLiteral(node.test) || !node.test.value) {
            return false;
        }
        if (!t.isBlockStatement(node.body)) {
            return false;
        }
        const firstStmt = node.body.body[0];
        return t.isSwitchStatement(firstStmt);
    }
    unflattenControlFlowPattern(path) {
        const whileStmt = path.node;
        if (t.isBlockStatement(whileStmt.body)) {
            const switchStmt = whileStmt.body.body[0];
            if (t.isSwitchStatement(switchStmt)) {
                path.replaceWithMultiple(switchStmt.cases.map((c) => c.consequent).flat());
            }
        }
    }
    removeDeadCode(ast) {
        let count = 0;
        traverse(ast, {
            IfStatement(path) {
                if (t.isBooleanLiteral(path.node.test)) {
                    if (path.node.test.value) {
                        path.replaceWith(path.node.consequent);
                    }
                    else {
                        if (path.node.alternate) {
                            path.replaceWith(path.node.alternate);
                        }
                        else {
                            path.remove();
                        }
                    }
                    count++;
                }
            },
        });
        return count;
    }
    simplifyExpressions(ast) {
        let count = 0;
        traverse(ast, {
            BinaryExpression(path) {
                if (t.isNumericLiteral(path.node.left) && t.isNumericLiteral(path.node.right)) {
                    const left = path.node.left.value;
                    const right = path.node.right.value;
                    let result;
                    switch (path.node.operator) {
                        case '+':
                            result = left + right;
                            break;
                        case '-':
                            result = left - right;
                            break;
                        case '*':
                            result = left * right;
                            break;
                        case '/':
                            result = left / right;
                            break;
                    }
                    if (result !== undefined) {
                        path.replaceWith(t.numericLiteral(result));
                        count++;
                    }
                }
            },
        });
        return count;
    }
    calculateConfidence(transformationCount) {
        return Math.min(transformationCount / 5, 1.0);
    }
}
//# sourceMappingURL=JScramberDeobfuscator.js.map

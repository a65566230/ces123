// @ts-nocheck

import * as parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import { logger } from '../../utils/logger.js';
import { resolveBabelTraverse } from '../../utils/babelTraverse.js';

const traverse = resolveBabelTraverse(traverseModule);
export function detectByAST(code, rulesManager) {
    const algorithms = [];
    const parameters = new Map();
    try {
        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript'],
            errorRecovery: true,
        });
        const constantRules = rulesManager.getConstantRules();
        traverse(ast, {
            VariableDeclarator(path) {
                const node = path.node;
                if (node.init?.type === 'ArrayExpression' &&
                    node.init.elements.length === 256 &&
                    node.id.type === 'Identifier' &&
                    (node.id.name.toLowerCase().includes('sbox') ||
                        node.id.name.toLowerCase().includes('box') ||
                        node.id.name.toLowerCase().includes('table'))) {
                    algorithms.push({
                        name: 'Custom Symmetric Cipher',
                        type: 'symmetric',
                        confidence: 0.8,
                        location: {
                            file: 'current',
                            line: node.loc?.start.line || 0,
                        },
                        usage: `S-box array detected (${node.id.name}), likely custom or standard symmetric encryption`,
                    });
                }
            },
            CallExpression(path) {
                const node = path.node;
                if (node.callee.type === 'MemberExpression' &&
                    node.callee.property.type === 'Identifier') {
                    const methodName = node.callee.property.name;
                    if (['modPow', 'modInverse', 'gcd', 'isProbablePrime'].includes(methodName)) {
                        algorithms.push({
                            name: 'Asymmetric Encryption',
                            type: 'asymmetric',
                            confidence: 0.75,
                            location: {
                                file: 'current',
                                line: node.loc?.start.line || 0,
                            },
                            usage: `Big number operation detected: ${methodName}`,
                        });
                    }
                    extractCryptoParameters(node, parameters);
                }
            },
            FunctionDeclaration(path) {
                const node = path.node;
                const funcName = node.id?.name.toLowerCase() || '';
                if (funcName.includes('hash') || funcName.includes('digest') || funcName.includes('checksum')) {
                    const bodyCode = code.substring(node.start || 0, node.end || 0);
                    const hasLoop = bodyCode.includes('for') || bodyCode.includes('while');
                    const hasBitOps = />>>|<<|&|\||\^/.test(bodyCode);
                    if (hasLoop && hasBitOps) {
                        algorithms.push({
                            name: 'Custom Hash Function',
                            type: 'hash',
                            confidence: 0.7,
                            location: {
                                file: 'current',
                                line: node.loc?.start.line || 0,
                            },
                            usage: `Hash function detected: ${funcName}`,
                        });
                    }
                }
            },
            ArrayExpression(path) {
                const elements = path.node.elements;
                if (elements.length < 4)
                    return;
                const values = [];
                elements.forEach((element) => {
                    if (t.isNumericLiteral(element)) {
                        values.push(element.value);
                    }
                });
                constantRules.forEach((rule) => {
                    const matches = rule.values.every((c, i) => values[i] === c);
                    if (matches) {
                        const algoType = rule.type === 'other' ? 'encoding' : rule.type;
                        algorithms.push({
                            name: rule.name,
                            type: algoType,
                            confidence: rule.confidence,
                            location: {
                                file: 'current',
                                line: path.node.loc?.start.line || 0,
                            },
                            usage: `${rule.name} initialization constants detected${rule.description ? ` (${rule.description})` : ''}`,
                        });
                    }
                });
            },
        });
    }
    catch (error) {
        logger.warn('AST detection failed', error);
    }
    return { algorithms, parameters };
}
function extractCryptoParameters(node, parameters) {
    if (!t.isMemberExpression(node.callee))
        return;
    const calleeName = getCalleeFullName(node.callee);
    if (calleeName.includes('CryptoJS')) {
        const algoMatch = calleeName.match(/CryptoJS\.(AES|DES|TripleDES|RC4|Rabbit|RabbitLegacy)/);
        if (algoMatch) {
            const algoName = algoMatch[1];
            const params = {};
            if (node.arguments.length >= 3 && t.isObjectExpression(node.arguments[2])) {
                const config = node.arguments[2];
                config.properties.forEach((prop) => {
                    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                        const key = prop.key.name;
                        if (t.isIdentifier(prop.value)) {
                            params[key] = prop.value.name;
                        }
                        else if (t.isStringLiteral(prop.value)) {
                            params[key] = prop.value.value;
                        }
                        else if (t.isNumericLiteral(prop.value)) {
                            params[key] = prop.value.value;
                        }
                    }
                });
            }
            if (algoName) {
                parameters.set(algoName, params);
            }
        }
    }
    if (calleeName.includes('crypto.subtle')) {
        const methodMatch = calleeName.match(/\.(encrypt|decrypt|sign|verify|digest|generateKey)/);
        if (methodMatch && node.arguments.length > 0) {
            const firstArg = node.arguments[0];
            if (t.isObjectExpression(firstArg)) {
                const params = {};
                firstArg.properties.forEach((prop) => {
                    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                        const key = prop.key.name;
                        if (t.isStringLiteral(prop.value)) {
                            params[key] = prop.value.value;
                        }
                        else if (t.isNumericLiteral(prop.value)) {
                            params[key] = prop.value.value;
                        }
                        else if (t.isIdentifier(prop.value)) {
                            params[key] = prop.value.name;
                        }
                    }
                });
                const algoName = params.name || 'WebCrypto';
                if (algoName) {
                    parameters.set(algoName, params);
                }
            }
        }
    }
}
function getCalleeFullName(node) {
    const parts = [];
    const traverseNode = (n) => {
        if (t.isMemberExpression(n)) {
            traverseNode(n.object);
            if (t.isIdentifier(n.property)) {
                parts.push(n.property.name);
            }
        }
        else if (t.isIdentifier(n)) {
            parts.push(n.name);
        }
    };
    traverseNode(node);
    return parts.join('.');
}
export function mergeParameters(algorithms, parameters) {
    algorithms.forEach((algo) => {
        const params = parameters.get(algo.name);
        if (params) {
            algo.parameters = { ...algo.parameters, ...params };
        }
    });
}
export function evaluateSecurity(algorithms, _code, rulesManager) {
    const issues = [];
    const securityRules = rulesManager.getSecurityRules();
    algorithms.forEach((algo) => {
        const context = {
            algorithm: algo.name,
            mode: algo.parameters?.mode,
            padding: algo.parameters?.padding,
            keySize: algo.parameters?.keySize,
        };
        securityRules.forEach((rule) => {
            if (rule.check(context)) {
                issues.push({
                    severity: rule.severity,
                    algorithm: algo.name,
                    issue: rule.message,
                    recommendation: rule.recommendation || '',
                    location: algo.location,
                });
            }
        });
    });
    return issues;
}
export function analyzeStrength(_algorithms, securityIssues) {
    let algorithmScore = 100;
    let keySizeScore = 100;
    let modeScore = 100;
    let implementationScore = 100;
    securityIssues.forEach((issue) => {
        const penalty = {
            critical: 40,
            high: 25,
            medium: 15,
            low: 5,
        }[issue.severity];
        if (issue.issue.includes('algorithm') || issue.issue.includes('broken')) {
            algorithmScore -= penalty;
        }
        else if (issue.issue.includes('key')) {
            keySizeScore -= penalty;
        }
        else if (issue.issue.includes('mode')) {
            modeScore -= penalty;
        }
        else {
            implementationScore -= penalty;
        }
    });
    algorithmScore = Math.max(0, algorithmScore);
    keySizeScore = Math.max(0, keySizeScore);
    modeScore = Math.max(0, modeScore);
    implementationScore = Math.max(0, implementationScore);
    const totalScore = (algorithmScore + keySizeScore + modeScore + implementationScore) / 4;
    let overall;
    if (totalScore >= 80) {
        overall = 'strong';
    }
    else if (totalScore >= 60) {
        overall = 'moderate';
    }
    else if (totalScore >= 40) {
        overall = 'weak';
    }
    else {
        overall = 'broken';
    }
    return {
        overall,
        score: Math.round(totalScore),
        factors: {
            algorithm: Math.round(algorithmScore),
            keySize: Math.round(keySizeScore),
            mode: Math.round(modeScore),
            implementation: Math.round(implementationScore),
        },
    };
}
//# sourceMappingURL=CryptoDetectorEnhanced.js.map

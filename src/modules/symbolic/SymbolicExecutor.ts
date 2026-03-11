// @ts-nocheck

import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { logger } from '../../utils/logger.js';
export class SymbolicExecutor {
    symbolCounter = 0;
    pathCounter = 0;
    async execute(options) {
        const startTime = Date.now();
        const { code, maxPaths = 100, maxDepth = 50, timeout = 30000, enableConstraintSolving = false, } = options;
        logger.info('🔬 开始符号执行分析...');
        const paths = [];
        const allSymbolicValues = [];
        const allConstraints = [];
        const warnings = [];
        try {
            const ast = parser.parse(code, {
                sourceType: 'unambiguous',
                plugins: ['jsx', 'typescript'],
                errorRecovery: true,
            });
            const initialState = {
                pc: 0,
                stack: [],
                registers: new Map(),
                memory: new Map(),
                pathConstraints: [],
            };
            const worklist = [
                { state: initialState, depth: 0 },
            ];
            while (worklist.length > 0 && paths.length < maxPaths) {
                if (Date.now() - startTime > timeout) {
                    warnings.push('符号执行超时');
                    break;
                }
                const { state, depth } = worklist.pop();
                if (depth >= maxDepth) {
                    warnings.push(`路径深度达到限制: ${maxDepth}`);
                    continue;
                }
                const nextStates = this.executeStep(state, ast);
                for (const nextState of nextStates) {
                    if (this.isTerminalState(nextState)) {
                        const path = this.createPath(nextState);
                        paths.push(path);
                        this.collectSymbolicValues(nextState, allSymbolicValues);
                        this.collectConstraints(nextState, allConstraints);
                    }
                    else {
                        worklist.push({ state: nextState, depth: depth + 1 });
                    }
                }
            }
            if (enableConstraintSolving) {
                await this.solveConstraints(paths, warnings);
            }
            const coverage = this.calculateCoverage(paths, ast);
            const executionTime = Date.now() - startTime;
            logger.info(`✅ 符号执行完成，耗时 ${executionTime}ms`);
            logger.info(`📊 生成路径: ${paths.length}`);
            logger.info(`📈 覆盖率: ${(coverage * 100).toFixed(1)}%`);
            return {
                paths,
                coverage,
                symbolicValues: allSymbolicValues,
                constraints: allConstraints,
                warnings,
                stats: {
                    totalPaths: paths.length,
                    feasiblePaths: paths.filter((p) => p.isFeasible).length,
                    infeasiblePaths: paths.filter((p) => !p.isFeasible).length,
                    executionTime,
                },
            };
        }
        catch (error) {
            logger.error('符号执行失败', error);
            throw error;
        }
    }
    executeStep(state, ast) {
        const nextStates = [];
        let currentNode = null;
        let nodeIndex = 0;
        traverse(ast, {
            enter(path) {
                if (nodeIndex === state.pc) {
                    currentNode = path.node;
                    path.stop();
                }
                nodeIndex++;
            },
        });
        if (!currentNode) {
            return [];
        }
        if (t.isVariableDeclaration(currentNode)) {
            const newState = this.cloneState(state);
            const varDecl = currentNode;
            varDecl.declarations.forEach((decl) => {
                if (t.isIdentifier(decl.id)) {
                    const varName = decl.id.name;
                    const symbolicValue = this.createSymbolicValue('unknown', varName, varName);
                    newState.memory.set(varName, symbolicValue);
                }
            });
            newState.pc++;
            nextStates.push(newState);
        }
        else if (t.isIfStatement(currentNode)) {
            const trueState = this.cloneState(state);
            const falseState = this.cloneState(state);
            const ifStmt = currentNode;
            const conditionExpr = this.nodeToString(ifStmt.test);
            trueState.pathConstraints.push({
                type: 'custom',
                expression: conditionExpr,
                description: '条件为真',
            });
            falseState.pathConstraints.push({
                type: 'custom',
                expression: `!(${conditionExpr})`,
                description: '条件为假',
            });
            trueState.pc++;
            falseState.pc++;
            nextStates.push(trueState, falseState);
        }
        else if (t.isWhileStatement(currentNode) || t.isForStatement(currentNode)) {
            const enterState = this.cloneState(state);
            const skipState = this.cloneState(state);
            enterState.pc++;
            skipState.pc += 2;
            nextStates.push(enterState, skipState);
        }
        else if (t.isAssignmentExpression(currentNode)) {
            const newState = this.cloneState(state);
            const assignExpr = currentNode;
            if (t.isIdentifier(assignExpr.left)) {
                const varName = assignExpr.left.name;
                const rightExpr = this.nodeToString(assignExpr.right);
                const symbolicValue = this.createSymbolicValue('unknown', rightExpr, rightExpr);
                newState.memory.set(varName, symbolicValue);
            }
            newState.pc++;
            nextStates.push(newState);
        }
        else {
            const newState = this.cloneState(state);
            newState.pc++;
            nextStates.push(newState);
        }
        return nextStates;
    }
    nodeToString(node) {
        if (t.isIdentifier(node)) {
            return node.name;
        }
        else if (t.isNumericLiteral(node)) {
            return String(node.value);
        }
        else if (t.isStringLiteral(node)) {
            return `"${node.value}"`;
        }
        else if (t.isBinaryExpression(node)) {
            return `${this.nodeToString(node.left)} ${node.operator} ${this.nodeToString(node.right)}`;
        }
        else if (t.isUnaryExpression(node)) {
            return `${node.operator}${this.nodeToString(node.argument)}`;
        }
        else {
            return '[Complex Expression]';
        }
    }
    isTerminalState(state) {
        if (state.pc > 1000) {
            return true;
        }
        if (state.pathConstraints.length > 50) {
            return true;
        }
        if (state.stack.length === 0 && state.memory.size === 0) {
            return true;
        }
        return false;
    }
    createPath(state) {
        const pathId = `path-${this.pathCounter++}`;
        const coverage = this.calculatePathCoverage(state);
        return {
            id: pathId,
            states: [state],
            constraints: [...state.pathConstraints],
            isFeasible: this.checkPathFeasibility(state.pathConstraints),
            coverage,
        };
    }
    calculatePathCoverage(state) {
        return Math.min(state.pc / 100, 1.0);
    }
    checkPathFeasibility(constraints) {
        const expressions = new Set();
        for (const constraint of constraints) {
            const expr = constraint.expression;
            if (expressions.has(`!(${expr})`)) {
                return false;
            }
            expressions.add(expr);
        }
        return true;
    }
    collectSymbolicValues(state, collection) {
        const seen = new Set();
        for (const value of state.stack) {
            if (!seen.has(value.id)) {
                collection.push(value);
                seen.add(value.id);
            }
        }
        for (const value of state.registers.values()) {
            if (!seen.has(value.id)) {
                collection.push(value);
                seen.add(value.id);
            }
        }
        for (const value of state.memory.values()) {
            if (!seen.has(value.id)) {
                collection.push(value);
                seen.add(value.id);
            }
        }
    }
    collectConstraints(state, collection) {
        const seen = new Set();
        for (const constraint of state.pathConstraints) {
            const key = `${constraint.type}:${constraint.expression}`;
            if (!seen.has(key)) {
                collection.push(constraint);
                seen.add(key);
            }
        }
        const allValues = [
            ...state.stack,
            ...Array.from(state.registers.values()),
            ...Array.from(state.memory.values()),
        ];
        for (const value of allValues) {
            for (const constraint of value.constraints) {
                const key = `${constraint.type}:${constraint.expression}`;
                if (!seen.has(key)) {
                    collection.push(constraint);
                    seen.add(key);
                }
            }
        }
    }
    async solveConstraints(paths, warnings) {
        logger.info('🔍 开始约束求解...');
        for (const path of paths) {
            const result = this.simpleSMTSolver(path.constraints);
            if (!result.satisfiable) {
                path.isFeasible = false;
                warnings.push(`路径 ${path.id} 不可行: ${result.reason}`);
            }
            else {
                path.isFeasible = true;
            }
        }
        logger.info(`✅ 约束求解完成，可行路径: ${paths.filter((p) => p.isFeasible).length}/${paths.length}`);
    }
    simpleSMTSolver(constraints) {
        const numericConstraints = constraints.filter((c) => c.type === 'range' || c.type === 'inequality');
        for (let i = 0; i < numericConstraints.length; i++) {
            for (let j = i + 1; j < numericConstraints.length; j++) {
                const c1 = numericConstraints[i];
                const c2 = numericConstraints[j];
                if (!c1 || !c2)
                    continue;
                if (this.areContradictory(c1.expression, c2.expression)) {
                    return {
                        satisfiable: false,
                        reason: `约束矛盾: ${c1.expression} 与 ${c2.expression}`,
                    };
                }
            }
        }
        return { satisfiable: true };
    }
    areContradictory(expr1, expr2) {
        const pattern1 = /(\w+)\s*>\s*(\d+)/;
        const pattern2 = /(\w+)\s*<\s*(\d+)/;
        const match1 = expr1.match(pattern1);
        const match2 = expr2.match(pattern2);
        if (match1 && match2 && match1[1] === match2[1] && match1[2] && match2[2]) {
            const val1 = parseInt(match1[2], 10);
            const val2 = parseInt(match2[2], 10);
            return val1 >= val2;
        }
        return false;
    }
    calculateCoverage(paths, ast) {
        let totalStatements = 0;
        traverse(ast, {
            Statement() {
                totalStatements++;
            },
        });
        if (totalStatements === 0) {
            return 0;
        }
        const coveredStatements = new Set();
        for (const path of paths) {
            for (const state of path.states) {
                coveredStatements.add(state.pc);
            }
        }
        return coveredStatements.size / totalStatements;
    }
    cloneState(state) {
        return {
            pc: state.pc,
            stack: [...state.stack],
            registers: new Map(state.registers),
            memory: new Map(state.memory),
            pathConstraints: [...state.pathConstraints],
        };
    }
    createSymbolicValue(type, name, source) {
        return {
            id: `sym-${this.symbolCounter++}`,
            type,
            name,
            constraints: [],
            source,
        };
    }
    addConstraint(value, type, expression, description) {
        value.constraints.push({
            type,
            expression,
            description,
        });
    }
}
//# sourceMappingURL=SymbolicExecutor.js.map
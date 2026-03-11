// @ts-nocheck

import { SymbolicExecutor } from './SymbolicExecutor.js';
import { logger } from '../../utils/logger.js';
export var JSVMPOpcode;
(function (JSVMPOpcode) {
    JSVMPOpcode[JSVMPOpcode["PUSH"] = 1] = "PUSH";
    JSVMPOpcode[JSVMPOpcode["POP"] = 2] = "POP";
    JSVMPOpcode[JSVMPOpcode["DUP"] = 3] = "DUP";
    JSVMPOpcode[JSVMPOpcode["ADD"] = 16] = "ADD";
    JSVMPOpcode[JSVMPOpcode["SUB"] = 17] = "SUB";
    JSVMPOpcode[JSVMPOpcode["MUL"] = 18] = "MUL";
    JSVMPOpcode[JSVMPOpcode["DIV"] = 19] = "DIV";
    JSVMPOpcode[JSVMPOpcode["MOD"] = 20] = "MOD";
    JSVMPOpcode[JSVMPOpcode["AND"] = 32] = "AND";
    JSVMPOpcode[JSVMPOpcode["OR"] = 33] = "OR";
    JSVMPOpcode[JSVMPOpcode["NOT"] = 34] = "NOT";
    JSVMPOpcode[JSVMPOpcode["XOR"] = 35] = "XOR";
    JSVMPOpcode[JSVMPOpcode["EQ"] = 48] = "EQ";
    JSVMPOpcode[JSVMPOpcode["NE"] = 49] = "NE";
    JSVMPOpcode[JSVMPOpcode["LT"] = 50] = "LT";
    JSVMPOpcode[JSVMPOpcode["LE"] = 51] = "LE";
    JSVMPOpcode[JSVMPOpcode["GT"] = 52] = "GT";
    JSVMPOpcode[JSVMPOpcode["GE"] = 53] = "GE";
    JSVMPOpcode[JSVMPOpcode["JMP"] = 64] = "JMP";
    JSVMPOpcode[JSVMPOpcode["JZ"] = 65] = "JZ";
    JSVMPOpcode[JSVMPOpcode["JNZ"] = 66] = "JNZ";
    JSVMPOpcode[JSVMPOpcode["CALL"] = 67] = "CALL";
    JSVMPOpcode[JSVMPOpcode["RET"] = 68] = "RET";
    JSVMPOpcode[JSVMPOpcode["LOAD"] = 80] = "LOAD";
    JSVMPOpcode[JSVMPOpcode["STORE"] = 81] = "STORE";
    JSVMPOpcode[JSVMPOpcode["LOAD_CONST"] = 82] = "LOAD_CONST";
    JSVMPOpcode[JSVMPOpcode["NOP"] = 0] = "NOP";
    JSVMPOpcode[JSVMPOpcode["HALT"] = 255] = "HALT";
})(JSVMPOpcode || (JSVMPOpcode = {}));
export class JSVMPSymbolicExecutor extends SymbolicExecutor {
    async executeJSVMP(options) {
        const startTime = Date.now();
        const { instructions, vmType = 'custom', maxSteps = 1000, timeout = 30000, } = options;
        logger.info('🔬 开始JSVMP符号执行...');
        logger.info(`📋 指令数量: ${instructions.length}`);
        logger.info(`🏷️ VM类型: ${vmType}`);
        const warnings = [];
        const executionTrace = [];
        try {
            let state = {
                pc: 0,
                stack: [],
                registers: new Map(),
                memory: new Map(),
                pathConstraints: [],
            };
            let steps = 0;
            while (state.pc < instructions.length && steps < maxSteps) {
                if (Date.now() - startTime > timeout) {
                    warnings.push('JSVMP符号执行超时');
                    break;
                }
                const instruction = instructions[state.pc];
                if (!instruction) {
                    warnings.push(`指令不存在: PC=${state.pc}`);
                    break;
                }
                executionTrace.push(this.cloneStateInternal(state));
                state = this.executeInstruction(state, instruction);
                if (instruction.opcode === JSVMPOpcode.HALT) {
                    break;
                }
                steps++;
            }
            const inferredLogic = this.inferLogic(executionTrace, instructions);
            const constraints = this.collectAllConstraints(executionTrace);
            const confidence = this.calculateConfidence(executionTrace, instructions);
            const executionTime = Date.now() - startTime;
            logger.info(`✅ JSVMP符号执行完成，耗时 ${executionTime}ms`);
            logger.info(`📊 执行步数: ${steps}`);
            logger.info(`📈 置信度: ${(confidence * 100).toFixed(1)}%`);
            return {
                finalState: state,
                executionTrace,
                inferredLogic,
                constraints,
                confidence,
                warnings,
            };
        }
        catch (error) {
            logger.error('JSVMP符号执行失败', error);
            throw error;
        }
    }
    executeInstruction(state, instruction) {
        const newState = this.cloneStateInternal(state);
        switch (instruction.opcode) {
            case JSVMPOpcode.PUSH:
                this.executePush(newState, instruction.operands[0]);
                break;
            case JSVMPOpcode.POP:
                this.executePop(newState);
                break;
            case JSVMPOpcode.ADD:
                this.executeAdd(newState);
                break;
            case JSVMPOpcode.SUB:
                this.executeSub(newState);
                break;
            case JSVMPOpcode.MUL:
                this.executeMul(newState);
                break;
            case JSVMPOpcode.LOAD:
                this.executeLoad(newState, instruction.operands[0]);
                break;
            case JSVMPOpcode.STORE:
                this.executeStore(newState, instruction.operands[0]);
                break;
            case JSVMPOpcode.JMP:
                newState.pc = instruction.operands[0];
                return newState;
            case JSVMPOpcode.JZ:
                this.executeJZ(newState, instruction.operands[0]);
                return newState;
            case JSVMPOpcode.CALL:
                this.executeCall(newState, instruction.operands[0]);
                break;
            default:
                logger.warn(`未知操作码: 0x${instruction.opcode.toString(16)}`);
        }
        newState.pc++;
        return newState;
    }
    executePush(state, value) {
        const symbolicValue = this.createSymbolicValue('unknown', `const_${value}`, String(value));
        symbolicValue.possibleValues = [value];
        state.stack.push(symbolicValue);
    }
    executePop(state) {
        return state.stack.pop();
    }
    executeAdd(state) {
        const b = state.stack.pop();
        const a = state.stack.pop();
        if (a && b) {
            const result = this.createSymbolicValue('number', `${a.name} + ${b.name}`);
            this.addConstraint(result, 'custom', `${result.name} = ${a.name} + ${b.name}`, '加法运算');
            state.stack.push(result);
        }
    }
    executeSub(state) {
        const b = state.stack.pop();
        const a = state.stack.pop();
        if (a && b) {
            const result = this.createSymbolicValue('number', `${a.name} - ${b.name}`);
            this.addConstraint(result, 'custom', `${result.name} = ${a.name} - ${b.name}`, '减法运算');
            state.stack.push(result);
        }
    }
    executeMul(state) {
        const b = state.stack.pop();
        const a = state.stack.pop();
        if (a && b) {
            const result = this.createSymbolicValue('number', `${a.name} * ${b.name}`);
            this.addConstraint(result, 'custom', `${result.name} = ${a.name} * ${b.name}`, '乘法运算');
            state.stack.push(result);
        }
    }
    executeLoad(state, varName) {
        const value = state.memory.get(varName);
        if (value) {
            state.stack.push(value);
        }
        else {
            const symbolicValue = this.createSymbolicValue('unknown', varName, varName);
            state.stack.push(symbolicValue);
        }
    }
    executeStore(state, varName) {
        const value = state.stack.pop();
        if (value) {
            state.memory.set(varName, value);
        }
    }
    executeJZ(state, target) {
        const condition = state.stack.pop();
        if (condition) {
            const constraint = {
                type: 'equality',
                expression: `${condition.name} == 0`,
                description: '零跳转条件',
            };
            state.pathConstraints.push(constraint);
            state.pc = target;
        }
    }
    executeCall(_state, funcName) {
        logger.info(`📞 调用函数: ${funcName}`);
    }
    inferLogic(trace, instructions) {
        const lines = [];
        for (let i = 0; i < Math.min(trace.length, 10); i++) {
            const state = trace[i];
            if (!state)
                continue;
            const instruction = instructions[state.pc];
            if (instruction) {
                lines.push(`// Step ${i}: ${JSVMPOpcode[instruction.opcode] || 'UNKNOWN'}`);
            }
        }
        return lines.join('\n') || '// 无法推断原始逻辑';
    }
    collectAllConstraints(trace) {
        const constraints = [];
        for (const state of trace) {
            constraints.push(...state.pathConstraints);
            for (const value of state.stack) {
                constraints.push(...value.constraints);
            }
        }
        return constraints;
    }
    calculateConfidence(trace, instructions) {
        const coverage = trace.length / instructions.length;
        return Math.min(coverage, 1.0);
    }
    cloneStateInternal(state) {
        return {
            pc: state.pc,
            stack: [...state.stack],
            registers: new Map(state.registers),
            memory: new Map(state.memory),
            pathConstraints: [...state.pathConstraints],
        };
    }
}
//# sourceMappingURL=JSVMPSymbolicExecutor.js.map
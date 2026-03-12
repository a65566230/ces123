// @ts-nocheck

import * as parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { logger } from '../../utils/logger.js';
import { resolveBabelTraverse } from '../../utils/babelTraverse.js';

const traverse = resolveBabelTraverse(traverseModule);

export class JSVMPDeobfuscator {
    llm;
    constructor(llm) {
        this.llm = llm;
    }
    async deobfuscate(options) {
        const startTime = Date.now();
        const { code, aggressive = false, extractInstructions = false, timeout = 30000, maxIterations = 100, } = options;
        logger.info('🔍 开始JSVMP反混淆分析...');
        try {
            const vmFeatures = this.detectJSVMP(code);
            if (!vmFeatures) {
                logger.info('未检测到JSVMP混淆');
                return {
                    isJSVMP: false,
                    deobfuscatedCode: code,
                    confidence: 0,
                    warnings: ['未检测到JSVMP特征'],
                };
            }
            logger.info(`✅ 检测到JSVMP混淆，复杂度: ${vmFeatures.complexity}`);
            logger.info(`📊 指令数量: ${vmFeatures.instructionCount}`);
            const vmType = this.identifyVMType(code, vmFeatures);
            logger.info(`🔧 虚拟机类型: ${vmType}`);
            let instructions;
            if (extractInstructions) {
                logger.info('📝 正在提取虚拟机指令集...');
                instructions = this.extractInstructions(code, vmFeatures);
                logger.info(`✅ 提取到 ${instructions.length} 条指令`);
            }
            logger.info('🔧 正在还原代码...');
            const deobfuscationResult = await this.restoreCode(code, vmFeatures, vmType, aggressive, timeout, maxIterations);
            const processingTime = Date.now() - startTime;
            const result = {
                isJSVMP: true,
                vmType,
                vmFeatures,
                instructions,
                deobfuscatedCode: deobfuscationResult.code,
                confidence: deobfuscationResult.confidence,
                warnings: deobfuscationResult.warnings,
                unresolvedParts: deobfuscationResult.unresolvedParts,
                stats: {
                    originalSize: code.length,
                    deobfuscatedSize: deobfuscationResult.code.length,
                    reductionRate: 1 - deobfuscationResult.code.length / code.length,
                    processingTime,
                },
            };
            logger.info(`✅ JSVMP反混淆完成，耗时 ${processingTime}ms`);
            logger.info(`📊 还原置信度: ${(result.confidence * 100).toFixed(1)}%`);
            return result;
        }
        catch (error) {
            logger.error('JSVMP反混淆失败', error);
            return {
                isJSVMP: false,
                deobfuscatedCode: code,
                confidence: 0,
                warnings: [`反混淆失败: ${error}`],
            };
        }
    }
    detectJSVMP(code) {
        try {
            const ast = parser.parse(code, {
                sourceType: 'unambiguous',
                plugins: ['jsx', 'typescript'],
                errorRecovery: true,
            });
            let hasSwitch = false;
            let hasInstructionArray = false;
            let hasProgramCounter = false;
            let instructionCount = 0;
            let interpreterLocation = '';
            let maxSwitchCases = 0;
            let hasBytecodeArray = false;
            let hasApplyCall = false;
            let hasWhileLoop = false;
            let bytecodePattern = false;
            traverse(ast, {
                SwitchStatement(path) {
                    const caseCount = path.node.cases.length;
                    if (caseCount > 10) {
                        hasSwitch = true;
                        if (caseCount > maxSwitchCases) {
                            maxSwitchCases = caseCount;
                            instructionCount = caseCount;
                            interpreterLocation = `Line ${path.node.loc?.start.line || 0}`;
                        }
                    }
                },
                ArrayExpression(path) {
                    if (path.node.elements.length > 50) {
                        hasInstructionArray = true;
                    }
                },
                UpdateExpression(path) {
                    if (path.node.operator === '++' || path.node.operator === '--') {
                        const arg = path.node.argument;
                        if (t.isIdentifier(arg) && arg.name.length <= 3) {
                            hasProgramCounter = true;
                        }
                    }
                },
                CallExpression(path) {
                    if (t.isIdentifier(path.node.callee, { name: 'parseInt' }) &&
                        path.node.arguments.length >= 2) {
                        const firstArg = path.node.arguments[0];
                        if (t.isBinaryExpression(firstArg) && firstArg.operator === '+') {
                            bytecodePattern = true;
                            hasBytecodeArray = true;
                        }
                    }
                    if (t.isMemberExpression(path.node.callee) &&
                        t.isIdentifier(path.node.callee.property, { name: 'apply' })) {
                        hasApplyCall = true;
                    }
                },
                WhileStatement(path) {
                    if (t.isBooleanLiteral(path.node.test, { value: true }) ||
                        t.isNumericLiteral(path.node.test, { value: 1 })) {
                        hasWhileLoop = true;
                    }
                },
                ForStatement(path) {
                    if (!path.node.test) {
                        hasWhileLoop = true;
                    }
                },
            });
            const isJSVMP = hasSwitch &&
                (hasInstructionArray || hasProgramCounter) &&
                (hasApplyCall || hasWhileLoop || bytecodePattern);
            if (isJSVMP) {
                const complexity = instructionCount > 100 ? 'high' : instructionCount > 50 ? 'medium' : 'low';
                logger.info('🔍 JSVMP特征检测结果:');
                logger.info(`  - Switch语句: ${hasSwitch} (${maxSwitchCases} cases)`);
                logger.info(`  - 指令数组: ${hasInstructionArray}`);
                logger.info(`  - 程序计数器: ${hasProgramCounter}`);
                logger.info(`  - 字节码数组: ${hasBytecodeArray}`);
                logger.info(`  - Apply调用: ${hasApplyCall}`);
                logger.info(`  - 大循环: ${hasWhileLoop}`);
                logger.info(`  - 字节码模式: ${bytecodePattern}`);
                return {
                    instructionCount,
                    interpreterLocation,
                    complexity,
                    hasSwitch,
                    hasInstructionArray,
                    hasProgramCounter,
                };
            }
            return null;
        }
        catch (error) {
            logger.warn('JSVMP检测失败，尝试使用正则表达式检测', error);
            return this.detectJSVMPWithRegex(code);
        }
    }
    detectJSVMPWithRegex(code) {
        const switchMatches = code.match(/switch\s*\(/g);
        const hasSwitch = (switchMatches?.length || 0) > 0;
        const bytecodePattern = /parseInt\s*\(\s*["']?\s*\+\s*\w+\[/g.test(code);
        const applyPattern = /\.apply\s*\(/g.test(code);
        const whilePattern = /while\s*\(\s*(true|1)\s*\)/g.test(code);
        if (hasSwitch && (bytecodePattern || applyPattern || whilePattern)) {
            logger.info('✅ 通过正则表达式检测到JSVMP特征');
            return {
                instructionCount: 0,
                interpreterLocation: 'Unknown',
                complexity: 'medium',
                hasSwitch: true,
                hasInstructionArray: bytecodePattern,
                hasProgramCounter: applyPattern,
            };
        }
        return null;
    }
    identifyVMType(code, _features) {
        if (code.includes('_0x') && code.includes('function(_0x')) {
            return 'obfuscator.io';
        }
        if (/^\s*\[\s*\]\s*\[\s*\(/.test(code)) {
            return 'jsfuck';
        }
        if (code.includes('$=~[];')) {
            return 'jjencode';
        }
        return 'custom';
    }
    extractInstructions(code, features) {
        const instructions = [];
        try {
            const ast = parser.parse(code, {
                sourceType: 'unambiguous',
                plugins: ['jsx', 'typescript'],
            });
            const self = this;
            traverse(ast, {
                SwitchStatement(path) {
                    if (path.node.cases.length === features.instructionCount) {
                        path.node.cases.forEach((caseNode, index) => {
                            const opcode = caseNode.test
                                ? t.isNumericLiteral(caseNode.test)
                                    ? caseNode.test.value
                                    : t.isStringLiteral(caseNode.test)
                                        ? caseNode.test.value
                                        : index
                                : index;
                            const type = self.inferInstructionType(caseNode);
                            instructions.push({
                                opcode,
                                name: `INST_${opcode}`,
                                type,
                                description: `Instruction ${opcode}`,
                            });
                        });
                    }
                },
            });
        }
        catch (error) {
            logger.warn('指令提取失败', error);
        }
        return instructions;
    }
    inferInstructionType(caseNode) {
        const code = generate(caseNode).code;
        const consequent = caseNode.consequent;
        let hasAssignment = false;
        let hasArrayAccess = false;
        let hasFunctionCall = false;
        let hasArithmetic = false;
        let hasControlFlow = false;
        for (const stmt of consequent) {
            if (t.isExpressionStatement(stmt)) {
                const expr = stmt.expression;
                if (t.isAssignmentExpression(expr)) {
                    hasAssignment = true;
                }
                if (t.isMemberExpression(expr) && t.isNumericLiteral(expr.property)) {
                    hasArrayAccess = true;
                }
                if (t.isCallExpression(expr)) {
                    hasFunctionCall = true;
                }
                if (t.isBinaryExpression(expr)) {
                    if (['+', '-', '*', '/', '%', '**'].includes(expr.operator)) {
                        hasArithmetic = true;
                    }
                }
            }
            if (t.isIfStatement(stmt) ||
                t.isWhileStatement(stmt) ||
                t.isBreakStatement(stmt) ||
                t.isContinueStatement(stmt) ||
                t.isReturnStatement(stmt)) {
                hasControlFlow = true;
            }
        }
        if ((code.includes('push') || code.includes('.push(')) &&
            (hasArrayAccess || code.includes('['))) {
            return 'load';
        }
        if (hasAssignment && !hasArithmetic && !hasFunctionCall) {
            return 'store';
        }
        if (hasArithmetic || code.match(/[+\-*/%]/)) {
            return 'arithmetic';
        }
        if (hasControlFlow || code.includes('break') || code.includes('continue')) {
            return 'control';
        }
        if (hasFunctionCall || code.includes('.apply(') || code.includes('.call(')) {
            return 'call';
        }
        return 'unknown';
    }
    async restoreCode(code, _features, vmType, aggressive, _timeout, _maxIterations) {
        const warnings = [];
        const unresolvedParts = [];
        if (vmType === 'obfuscator.io') {
            return this.restoreObfuscatorIO(code, aggressive, warnings, unresolvedParts);
        }
        else if (vmType === 'jsfuck') {
            return this.restoreJSFuck(code, warnings);
        }
        else if (vmType === 'jjencode') {
            return this.restoreJJEncode(code, warnings);
        }
        else {
            return this.restoreCustomVM(code, aggressive, warnings, unresolvedParts);
        }
    }
    restoreObfuscatorIO(code, aggressive, warnings, unresolvedParts) {
        let restored = code;
        let confidence = 0.5;
        try {
            const stringArrayMatch = code.match(/var\s+(_0x[a-f0-9]+)\s*=\s*(\[.*?\]);/s);
            if (stringArrayMatch) {
                const arrayName = stringArrayMatch[1];
                const arrayContent = stringArrayMatch[2];
                logger.info(`🔍 发现字符串数组: ${arrayName}`);
                try {
                    const arrayFunc = new Function(`return ${arrayContent || '[]'};`);
                    const stringArray = arrayFunc();
                    if (Array.isArray(stringArray)) {
                        logger.info(`✅ 成功解析字符串数组，包含 ${stringArray.length} 个字符串`);
                        const refPattern = new RegExp(`${arrayName}\\[(\\d+)\\]`, 'g');
                        restored = restored.replace(refPattern, (_match, index) => {
                            const idx = parseInt(index, 10);
                            if (idx < stringArray.length) {
                                return JSON.stringify(stringArray[idx]);
                            }
                            return _match;
                        });
                        confidence += 0.2;
                    }
                }
                catch (e) {
                    warnings.push(`字符串数组解析失败: ${e}`);
                    unresolvedParts.push({
                        location: 'String Array',
                        reason: '无法解析字符串数组',
                        suggestion: '手动提取字符串数组内容',
                    });
                }
            }
            restored = restored.replace(/\(function\s*\(_0x[a-f0-9]+,\s*_0x[a-f0-9]+\)\s*\{[\s\S]*?\}\(_0x[a-f0-9]+,\s*0x[a-f0-9]+\)\);?/g, '');
            if (aggressive) {
                restored = restored.replace(/\(function\s*\(\)\s*\{([\s\S]*)\}\(\)\);?/g, '$1');
                confidence += 0.1;
            }
            restored = restored.replace(/0x([0-9a-f]+)/gi, (_match, hex) => {
                return String(parseInt(hex, 16));
            });
            restored = restored.replace(/;\s*;/g, ';');
            restored = restored.replace(/\{\s*\}/g, '{}');
            warnings.push('obfuscator.io还原完成，部分复杂逻辑可能需要手动处理');
            return {
                code: restored,
                confidence: Math.min(confidence, 1.0),
                warnings,
                unresolvedParts: unresolvedParts.length > 0 ? unresolvedParts : undefined,
            };
        }
        catch (error) {
            warnings.push(`obfuscator.io还原失败: ${error}`);
            return {
                code,
                confidence: 0.2,
                warnings,
                unresolvedParts,
            };
        }
    }
    restoreJSFuck(code, warnings) {
        try {
            logger.info('🔍 检测到JSFuck混淆，尝试还原...');
            try {
                if (code.length > 100000) {
                    warnings.push('JSFuck代码过长，可能导致执行超时');
                    warnings.push('建议：使用在线JSFuck解码器 https://enkhee-osiris.github.io/Decoder-JSFuck/');
                    return {
                        code,
                        confidence: 0.1,
                        warnings,
                    };
                }
                const func = new Function(`return ${code};`);
                const result = func();
                if (typeof result === 'string') {
                    logger.info('✅ JSFuck还原成功');
                    return {
                        code: result,
                        confidence: 0.9,
                        warnings: ['JSFuck已成功还原'],
                    };
                }
                else {
                    warnings.push('JSFuck执行结果不是字符串');
                    return {
                        code,
                        confidence: 0.2,
                        warnings,
                    };
                }
            }
            catch (execError) {
                warnings.push(`JSFuck执行失败: ${execError}`);
                warnings.push('建议：使用在线JSFuck解码器 https://enkhee-osiris.github.io/Decoder-JSFuck/');
                return {
                    code,
                    confidence: 0.1,
                    warnings,
                };
            }
        }
        catch (error) {
            warnings.push(`JSFuck还原失败: ${error}`);
            return {
                code,
                confidence: 0.1,
                warnings,
            };
        }
    }
    restoreJJEncode(code, warnings) {
        try {
            logger.info('🔍 检测到JJEncode混淆，尝试还原...');
            try {
                const lines = code.split('\n').filter((line) => line.trim());
                const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
                if (lastLine && lastLine.includes('$$$$')) {
                    const func = new Function(`${code}; return $$$$()`);
                    const result = func();
                    if (typeof result === 'string') {
                        logger.info('✅ JJEncode还原成功');
                        return {
                            code: result,
                            confidence: 0.9,
                            warnings: ['JJEncode已成功还原'],
                        };
                    }
                }
                const func2 = new Function(code);
                func2();
                warnings.push('JJEncode执行完成，但无法提取原始代码');
                warnings.push('建议：使用在线JJEncode解码器');
                return {
                    code,
                    confidence: 0.2,
                    warnings,
                };
            }
            catch (execError) {
                warnings.push(`JJEncode执行失败: ${execError}`);
                warnings.push('建议：手动分析或使用在线解码器');
                return {
                    code,
                    confidence: 0.1,
                    warnings,
                };
            }
        }
        catch (error) {
            warnings.push(`JJEncode还原失败: ${error}`);
            return {
                code,
                confidence: 0.1,
                warnings,
            };
        }
    }
    async restoreCustomVM(code, aggressive, warnings, unresolvedParts) {
        if (!this.llm) {
            warnings.push('未配置LLM服务，无法进行智能还原');
            warnings.push('建议：配置DeepSeek/OpenAI API以启用AI辅助反混淆');
            return this.restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
        }
        try {
            logger.info('🤖 使用LLM辅助分析自定义VM...');
            const codeSnippet = code.substring(0, 5000);
            const prompt = `你是一个JavaScript逆向工程专家，专门分析JSVMP（JavaScript Virtual Machine Protection）混淆代码。

以下是一段JSVMP混淆的JavaScript代码片段：

\`\`\`javascript
${codeSnippet}
\`\`\`

请分析这段代码并回答以下问题：

1. **VM类型识别**：这是什么类型的虚拟机保护？（obfuscator.io / 自定义VM / 其他）

2. **指令集分析**：
   - 程序计数器（PC）变量名是什么？
   - 操作数栈（Stack）变量名是什么？
   - 寄存器（Registers）变量名是什么？
   - 字节码数组变量名是什么？

3. **关键函数定位**：
   - VM解释器函数的位置（函数名或行号）
   - 指令分发器（switch语句）的位置
   - 字节码解析函数的位置

4. **还原建议**：
   - 如何提取字节码？
   - 如何还原原始逻辑？
   - 有哪些需要注意的陷阱？

请以JSON格式返回分析结果：
{
  "vmType": "类型",
  "programCounter": "PC变量名",
  "stack": "栈变量名",
  "registers": "寄存器变量名",
  "bytecodeArray": "字节码数组变量名",
  "interpreterFunction": "解释器函数位置",
  "restorationSteps": ["步骤1", "步骤2", ...],
  "warnings": ["警告1", "警告2", ...]
}`;
            const response = await this.llm.chat([
                {
                    role: 'user',
                    content: prompt,
                },
            ]);
            const analysisText = response.content;
            logger.info('✅ LLM分析完成');
            logger.info(`分析结果: ${analysisText.substring(0, 200)}...`);
            let vmAnalysis;
            try {
                const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    vmAnalysis = JSON.parse(jsonMatch[0]);
                }
            }
            catch (e) {
                warnings.push('LLM返回结果解析失败，使用基础还原方法');
                return this.restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
            }
            if (vmAnalysis) {
                warnings.push(`LLM识别的VM类型: ${vmAnalysis.vmType || 'Unknown'}`);
                if (vmAnalysis.warnings && Array.isArray(vmAnalysis.warnings)) {
                    warnings.push(...vmAnalysis.warnings);
                }
                if (vmAnalysis.restorationSteps && Array.isArray(vmAnalysis.restorationSteps)) {
                    unresolvedParts.push({
                        location: 'VM Restoration',
                        reason: 'LLM建议的还原步骤',
                        suggestion: vmAnalysis.restorationSteps.join('\n'),
                    });
                }
                return {
                    code,
                    confidence: 0.6,
                    warnings,
                    unresolvedParts: unresolvedParts.length > 0 ? unresolvedParts : undefined,
                };
            }
            return this.restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
        }
        catch (error) {
            logger.error('LLM辅助还原失败', error);
            warnings.push(`LLM辅助还原失败: ${error}`);
            return this.restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
        }
    }
    restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts) {
        let restored = code;
        let confidence = 0.3;
        try {
            restored = restored.replace(/if\s*\([^)]*\)\s*\{\s*\}/g, '');
            restored = restored.replace(/!!\s*\(/g, 'Boolean(');
            restored = restored.replace(/""\s*\+\s*/g, '');
            if (aggressive) {
                restored = restored.replace(/debugger;?/g, '');
                confidence += 0.1;
                restored = restored.replace(/\?\s*([^:]+)\s*:\s*\1/g, '$1');
                confidence += 0.05;
            }
            warnings.push('使用基础模式匹配进行还原，结果可能不完整');
            warnings.push('建议：配置LLM服务以获得更好的还原效果');
            unresolvedParts.push({
                location: 'Custom VM',
                reason: '自定义VM需要深度分析',
                suggestion: '建议使用插桩技术记录VM执行流程，或配置LLM服务进行智能分析',
            });
            return {
                code: restored,
                confidence,
                warnings,
                unresolvedParts: unresolvedParts.length > 0 ? unresolvedParts : undefined,
            };
        }
        catch (error) {
            warnings.push(`基础还原失败: ${error}`);
            return {
                code,
                confidence: 0.1,
                warnings,
                unresolvedParts,
            };
        }
    }
}
//# sourceMappingURL=JSVMPDeobfuscator.js.map

// @ts-nocheck

import { logger } from '../../utils/logger.js';
import * as parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { resolveBabelTraverse } from '../../utils/babelTraverse.js';

const traverse = resolveBabelTraverse(traverseModule);

export class AdvancedDeobfuscator {
    llm;
    constructor(llm) {
        this.llm = llm;
    }
    async deobfuscate(options) {
        logger.info('Starting advanced deobfuscation...');
        const startTime = Date.now();
        let code = options.code;
        const detectedTechniques = [];
        const warnings = [];
        let vmDetected;
        let astOptimized = false;
        try {
            code = this.normalizeCode(code);
            if (this.detectInvisibleUnicode(code)) {
                detectedTechniques.push('invisible-unicode');
                logger.info('Detected: Invisible Unicode Obfuscation (2025)');
                code = this.decodeInvisibleUnicode(code);
            }
            if (this.detectStringEncoding(code)) {
                detectedTechniques.push('string-encoding');
                logger.info('Detected: String Encoding');
                code = this.decodeStrings(code);
            }
            const vmInfo = this.detectVMProtection(code);
            if (vmInfo.detected) {
                detectedTechniques.push('vm-protection');
                logger.info(`Detected: VM Protection (${vmInfo.type})`);
                vmDetected = {
                    type: vmInfo.type,
                    instructions: vmInfo.instructionCount,
                    deobfuscated: false,
                };
                if (options.aggressiveVM) {
                    const vmResult = await this.deobfuscateVM(code, vmInfo);
                    if (vmResult.success) {
                        code = vmResult.code;
                        vmDetected.deobfuscated = true;
                    }
                    else {
                        warnings.push('VM deobfuscation failed, code may be incomplete');
                    }
                }
            }
            if (this.detectControlFlowFlattening(code)) {
                detectedTechniques.push('control-flow-flattening');
                logger.info('Detected: Control Flow Flattening');
                code = await this.unflattenControlFlow(code);
            }
            if (this.detectStringArrayRotation(code)) {
                detectedTechniques.push('string-array-rotation');
                logger.info('Detected: String Array Rotation');
                code = this.derotateStringArray(code);
            }
            if (this.detectDeadCodeInjection(code)) {
                detectedTechniques.push('dead-code-injection');
                logger.info('Detected: Dead Code Injection');
                code = this.removeDeadCode(code);
            }
            if (this.detectOpaquePredicates(code)) {
                detectedTechniques.push('opaque-predicates');
                logger.info('Detected: Opaque Predicates');
                code = this.removeOpaquePredicates(code);
            }
            if (options.useASTOptimization !== false) {
                logger.info('Applying AST optimizations...');
                const optimized = this.applyASTOptimizations(code);
                if (optimized !== code) {
                    code = optimized;
                    astOptimized = true;
                    detectedTechniques.push('ast-optimized');
                }
            }
            if (this.llm && detectedTechniques.length > 0) {
                logger.info('Using LLM for final cleanup...');
                const llmResult = await this.llmCleanup(code, detectedTechniques);
                if (llmResult) {
                    code = llmResult;
                }
            }
            const duration = Date.now() - startTime;
            const confidence = this.calculateConfidence(detectedTechniques, warnings, code);
            logger.success(`Advanced deobfuscation completed in ${duration}ms`);
            return {
                code,
                detectedTechniques,
                confidence,
                warnings,
                vmDetected,
                astOptimized,
            };
        }
        catch (error) {
            logger.error('Advanced deobfuscation failed', error);
            throw error;
        }
    }
    detectInvisibleUnicode(code) {
        const invisibleChars = [
            '\u200B',
            '\u200C',
            '\u200D',
            '\u2060',
            '\uFEFF',
        ];
        return invisibleChars.some(char => code.includes(char));
    }
    decodeInvisibleUnicode(code) {
        logger.info('Decoding invisible unicode...');
        const charToBit = {
            '\u200B': '0',
            '\u200C': '1',
            '\u200D': '00',
            '\u2060': '01',
            '\uFEFF': '10',
        };
        let decoded = code;
        const invisiblePattern = /[\u200B\u200C\u200D\u2060\uFEFF]+/g;
        const matches = code.match(invisiblePattern);
        if (matches) {
            matches.forEach(match => {
                let binary = '';
                for (const char of match) {
                    binary += charToBit[char] || '';
                }
                if (binary.length % 8 === 0) {
                    let text = '';
                    for (let i = 0; i < binary.length; i += 8) {
                        const byte = binary.substring(i, i + 8);
                        text += String.fromCharCode(parseInt(byte, 2));
                    }
                    decoded = decoded.replace(match, text);
                }
            });
        }
        return decoded;
    }
    detectVMProtection(code) {
        const vmPatterns = [
            /while\s*\(\s*true\s*\)\s*\{[\s\S]*?switch\s*\(/i,
            /var\s+\w+\s*=\s*\[\s*\d+(?:\s*,\s*\d+){10,}\s*\]/i,
            /\w+\[pc\+\+\]/i,
            /stack\.push|stack\.pop/i,
        ];
        const matchCount = vmPatterns.filter(pattern => pattern.test(code)).length;
        if (matchCount >= 2) {
            return {
                detected: true,
                type: matchCount >= 3 ? 'custom-vm' : 'simple-vm',
                instructionCount: this.countVMInstructions(code),
            };
        }
        return { detected: false, type: 'none', instructionCount: 0 };
    }
    countVMInstructions(code) {
        const match = code.match(/case\s+\d+:/g);
        return match ? match.length : 0;
    }
    async deobfuscateVM(code, vmInfo) {
        logger.warn('VM deobfuscation is experimental and may fail');
        try {
            const vmStructure = this.analyzeVMStructure(code);
            if (vmStructure.hasInterpreter) {
                logger.info(`Detected VM interpreter with ${vmStructure.instructionTypes.length} instruction types`);
            }
            const vmComponents = this.extractVMComponents(code);
            if (this.llm) {
                const prompt = this.buildVMDeobfuscationPrompt(code, vmInfo, vmStructure, vmComponents);
                const response = await this.llm.chat([
                    {
                        role: 'system',
                        content: `# Role
You are a world-class expert in JavaScript VM deobfuscation and reverse engineering with expertise in:
- Virtual machine architecture and instruction set design
- Bytecode interpretation and JIT compilation
- Control flow reconstruction from VM instructions
- Stack-based and register-based VM analysis
- Obfuscation techniques used by TikTok, Shopee, and commercial protectors

# Task
Analyze VM-protected JavaScript code and reconstruct the original, readable JavaScript.

# Methodology
1. **Identify VM Components**: Locate instruction array, interpreter loop, stack/registers
2. **Decode Instructions**: Map VM opcodes to JavaScript operations
3. **Reconstruct Control Flow**: Convert VM jumps/branches to if/while/for
4. **Simplify**: Remove VM overhead and restore natural code structure
5. **Validate**: Ensure output is syntactically valid and functionally equivalent

# Critical Requirements
- Output ONLY valid, executable JavaScript (no markdown, no explanations)
- Preserve exact program logic and side effects
- Use meaningful variable names based on context
- Add brief comments for complex patterns
- Do NOT hallucinate or guess functionality
- If uncertain, preserve original code structure

# Output Format
Return clean JavaScript code without any wrapper or formatting.`
                    },
                    { role: 'user', content: prompt },
                ], {
                    temperature: 0.05,
                    maxTokens: 4000,
                });
                const deobfuscatedCode = this.extractCodeFromLLMResponse(response.content);
                if (this.isValidJavaScript(deobfuscatedCode)) {
                    logger.success('VM deobfuscation succeeded via LLM');
                    return {
                        success: true,
                        code: deobfuscatedCode,
                    };
                }
                else {
                    logger.warn('LLM output is not valid JavaScript, falling back to original');
                }
            }
            const simplifiedCode = this.simplifyVMCode(code, vmComponents);
            return {
                success: simplifiedCode !== code,
                code: simplifiedCode
            };
        }
        catch (error) {
            logger.error('VM deobfuscation failed', error);
            return { success: false, code };
        }
    }
    analyzeVMStructure(code) {
        const structure = {
            hasInterpreter: false,
            instructionTypes: [],
            hasStack: false,
            hasRegisters: false,
        };
        if (/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/.test(code)) {
            structure.hasInterpreter = true;
        }
        const switchMatches = code.match(/case\s+0x[0-9a-f]+:/gi);
        if (switchMatches && switchMatches.length > 10) {
            structure.hasInterpreter = true;
            structure.instructionTypes = switchMatches.map(m => m.replace(/case\s+/i, '').replace(/:/, ''));
        }
        if (/\.push\(|\.pop\(/.test(code)) {
            structure.hasStack = true;
        }
        if (/r\d+\s*=|reg\[\d+\]/.test(code)) {
            structure.hasRegisters = true;
        }
        return structure;
    }
    extractVMComponents(code) {
        const components = {};
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            traverse(ast, {
                VariableDeclarator(path) {
                    if (t.isArrayExpression(path.node.init)) {
                        const arrayLength = path.node.init.elements.length;
                        if (arrayLength > 50) {
                            const arrayName = t.isIdentifier(path.node.id) ? path.node.id.name : 'unknown';
                            const firstElement = path.node.init.elements[0];
                            if (t.isNumericLiteral(firstElement)) {
                                components.instructionArray = arrayName;
                            }
                            else if (t.isStringLiteral(firstElement)) {
                                components.dataArray = arrayName;
                            }
                        }
                    }
                },
                FunctionDeclaration(path) {
                    let hasBigSwitch = false;
                    traverse(path.node, {
                        SwitchStatement(switchPath) {
                            if (switchPath.node.cases.length > 10) {
                                hasBigSwitch = true;
                            }
                        },
                    }, path.scope, path);
                    if (hasBigSwitch && t.isIdentifier(path.node.id)) {
                        components.interpreterFunction = path.node.id.name;
                    }
                },
            });
        }
        catch (error) {
            logger.debug('Failed to extract VM components:', error);
        }
        return components;
    }
    buildVMDeobfuscationPrompt(code, vmInfo, vmStructure, vmComponents) {
        const codeSnippet = code.length > 6000 ? code.substring(0, 6000) + '\n\n// ... (code truncated)' : code;
        return `# VM Deobfuscation Analysis

## VM Profile
- **Architecture**: ${vmInfo.type}
- **Instruction Count**: ${vmInfo.instructionCount}
- **Interpreter Loop**: ${vmStructure.hasInterpreter ? 'Detected' : 'Not detected'}
- **Stack Operations**: ${vmStructure.hasStack ? 'Present' : 'Absent'}
- **Register Usage**: ${vmStructure.hasRegisters ? 'Present' : 'Absent'}
- **Instruction Variety**: ${vmStructure.instructionTypes.length} distinct types

## Identified Components
${vmComponents.instructionArray ? `✓ Instruction Array: Found at ${vmComponents.instructionArray}` : '✗ Instruction Array: Not found'}
${vmComponents.dataArray ? `✓ Data Array: Found at ${vmComponents.dataArray}` : '✗ Data Array: Not found'}
${vmComponents.interpreterFunction ? `✓ Interpreter Function: Found at ${vmComponents.interpreterFunction}` : '✗ Interpreter Function: Not found'}

## VM-Protected Code
\`\`\`javascript
${codeSnippet}
\`\`\`

## Deobfuscation Instructions (Chain-of-Thought)

### Step 1: VM Structure Analysis
Examine the code to identify:
- Instruction array (usually a large array of numbers/strings)
- Interpreter loop (while/for loop processing instructions)
- Stack/register variables
- Opcode handlers (switch-case or if-else chains)

### Step 2: Instruction Decoding
For each instruction type, determine:
- What JavaScript operation it represents (e.g., opcode 0x01 = addition)
- How it manipulates the stack/registers
- What side effects it has (function calls, property access, etc.)

### Step 3: Control Flow Reconstruction
- Map VM jumps/branches to JavaScript if/while/for statements
- Identify function calls and returns
- Reconstruct try-catch blocks if present

### Step 4: Code Generation
- Replace VM instruction sequences with equivalent JavaScript
- Use meaningful variable names based on usage context
- Remove VM overhead (interpreter loop, stack management)
- Preserve all side effects and program behavior

### Step 5: Validation
- Ensure output is syntactically valid JavaScript
- Verify no functionality is lost
- Add comments for complex patterns

## Example Transformation (Few-shot Learning)

**VM Code (Before)**:
\`\`\`javascript
var vm = [0x01, 0x05, 0x02, 0x03, 0x10];
var stack = [];
for(var i=0; i<vm.length; i++) {
  switch(vm[i]) {
    case 0x01: stack.push(5); break;
    case 0x02: stack.push(3); break;
    case 0x10: var b=stack.pop(), a=stack.pop(); stack.push(a+b); break;
  }
}
console.log(stack[0]);
\`\`\`

**Deobfuscated Code (After)**:
\`\`\`javascript
// VM instructions decoded: PUSH 5, PUSH 3, ADD
var result = 5 + 3;
console.log(result);
\`\`\`

## Critical Requirements
1. Output ONLY the deobfuscated JavaScript code
2. NO markdown code blocks, NO explanations, NO comments outside the code
3. Code must be syntactically valid and executable
4. Preserve exact program logic and side effects
5. If full deobfuscation is impossible, return the best partial result

## Output Format
Return clean JavaScript code starting immediately (no preamble).`;
    }
    extractCodeFromLLMResponse(response) {
        let code = response.trim();
        code = code.replace(/^```(?:javascript|js)?\s*\n/i, '');
        code = code.replace(/\n```\s*$/i, '');
        return code.trim();
    }
    isValidJavaScript(code) {
        try {
            parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            return true;
        }
        catch {
            return false;
        }
    }
    simplifyVMCode(code, vmComponents) {
        try {
            let simplified = code;
            if (vmComponents.interpreterFunction) {
                const regex = new RegExp(`function\\s+${vmComponents.interpreterFunction}\\s*\\([^)]*\\)\\s*\\{[^}]*\\}`, 'g');
                simplified = simplified.replace(regex, '// VM interpreter removed');
            }
            if (vmComponents.instructionArray) {
                const regex = new RegExp(`var\\s+${vmComponents.instructionArray}\\s*=\\s*\\[[^\\]]*\\];`, 'g');
                simplified = simplified.replace(regex, '// VM instruction array removed');
            }
            return simplified;
        }
        catch (error) {
            logger.debug('Failed to simplify VM code:', error);
            return code;
        }
    }
    detectControlFlowFlattening(code) {
        const pattern = /while\s*\(\s*!!\s*\[\s*\]\s*\)\s*\{[\s\S]*?switch\s*\(/i;
        return pattern.test(code);
    }
    async unflattenControlFlow(code) {
        logger.info('Unflattening control flow...');
        if (this.llm) {
            try {
                const codeSnippet = code.length > 3000 ? code.substring(0, 3000) + '\n\n// ... (truncated)' : code;
                const response = await this.llm.chat([
                    {
                        role: 'system',
                        content: `# Role
You are an expert in JavaScript control flow deobfuscation specializing in:
- Control flow flattening detection and removal
- Switch-case state machine analysis
- Dispatcher loop identification
- Control flow graph (CFG) reconstruction

# Task
Analyze control flow flattened JavaScript and reconstruct the original, natural control flow.

# Control Flow Flattening Pattern
Obfuscators replace normal if/while/for with a dispatcher loop:
\`\`\`javascript
// Flattened (obfuscated)
var state = '0';
while (true) {
  switch (state) {
    case '0': console.log('a'); state = '1'; break;
    case '1': console.log('b'); state = '2'; break;
    case '2': return;
  }
}

// Original (deobfuscated)
console.log('a');
console.log('b');
return;
\`\`\`

# Requirements
- Output ONLY valid JavaScript code
- Preserve exact program logic
- Remove dispatcher loops and state variables
- Restore natural if/while/for structures
- Use meaningful variable names`
                    },
                    {
                        role: 'user',
                        content: `# Control Flow Flattened Code
\`\`\`javascript
${codeSnippet}
\`\`\`

# Instructions
1. Identify the dispatcher loop (while/for with switch-case)
2. Trace state transitions to determine execution order
3. Reconstruct original control flow (if/while/for)
4. Remove state variables and dispatcher overhead
5. Return ONLY the deobfuscated code (no explanations)

Output the deobfuscated JavaScript code:`
                    },
                ], {
                    temperature: 0.1,
                    maxTokens: 3000,
                });
                return this.extractCodeFromLLMResponse(response.content);
            }
            catch (error) {
                logger.warn('LLM control flow unflattening failed', error);
            }
        }
        return code;
    }
    detectStringArrayRotation(code) {
        return /\w+\s*=\s*\w+\s*\+\s*0x[0-9a-f]+/.test(code);
    }
    derotateStringArray(code) {
        logger.info('Derotating string array...');
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            let derotated = 0;
            traverse(ast, {
                CallExpression(path) {
                    if (!t.isFunctionExpression(path.node.callee) &&
                        !t.isArrowFunctionExpression(path.node.callee)) {
                        return;
                    }
                    const func = path.node.callee;
                    if (!t.isFunctionExpression(func) || !t.isBlockStatement(func.body)) {
                        return;
                    }
                    const hasWhileLoop = func.body.body.some(stmt => t.isWhileStatement(stmt));
                    const hasArrayRotation = JSON.stringify(func.body).includes('push') &&
                        JSON.stringify(func.body).includes('shift');
                    if (hasWhileLoop && hasArrayRotation) {
                        logger.debug('Found string array rotation IIFE');
                        path.remove();
                        derotated++;
                    }
                },
            });
            if (derotated > 0) {
                logger.info(`Removed ${derotated} string array rotation functions`);
                return generate(ast, { comments: true, compact: false }).code;
            }
            return code;
        }
        catch (error) {
            logger.error('Failed to derotate string array:', error);
            return code;
        }
    }
    detectDeadCodeInjection(code) {
        return /if\s*\(\s*false\s*\)|if\s*\(\s*!!\s*\[\s*\]\s*\)/.test(code);
    }
    removeDeadCode(code) {
        logger.info('Removing dead code...');
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            let removed = 0;
            traverse(ast, {
                IfStatement(path) {
                    const test = path.node.test;
                    if (t.isBooleanLiteral(test) && test.value === false) {
                        if (path.node.alternate) {
                            path.replaceWith(path.node.alternate);
                        }
                        else {
                            path.remove();
                        }
                        removed++;
                        return;
                    }
                    if (t.isBooleanLiteral(test) && test.value === true) {
                        path.replaceWith(path.node.consequent);
                        removed++;
                        return;
                    }
                    if (t.isUnaryExpression(test) && test.operator === '!' &&
                        t.isUnaryExpression(test.argument) && test.argument.operator === '!' &&
                        t.isArrayExpression(test.argument.argument)) {
                        path.replaceWith(path.node.consequent);
                        removed++;
                        return;
                    }
                },
                BlockStatement(path) {
                    const body = path.node.body;
                    let foundTerminator = false;
                    const newBody = [];
                    for (const stmt of body) {
                        if (foundTerminator) {
                            removed++;
                            continue;
                        }
                        newBody.push(stmt);
                        if (t.isReturnStatement(stmt) || t.isThrowStatement(stmt)) {
                            foundTerminator = true;
                        }
                    }
                    if (newBody.length < body.length) {
                        path.node.body = newBody;
                    }
                },
            });
            if (removed > 0) {
                logger.info(`Removed ${removed} dead code blocks`);
                return generate(ast, { comments: true, compact: false }).code;
            }
            return code;
        }
        catch (error) {
            logger.error('Failed to remove dead code:', error);
            return code;
        }
    }
    detectOpaquePredicates(code) {
        return /if\s*\(\s*\d+\s*[<>!=]+\s*\d+\s*\)/.test(code);
    }
    removeOpaquePredicates(code) {
        logger.info('Removing opaque predicates...');
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            let removed = 0;
            traverse(ast, {
                IfStatement(path) {
                    const test = path.node.test;
                    if (t.isBinaryExpression(test)) {
                        const left = test.left;
                        const right = test.right;
                        const operator = test.operator;
                        if (t.isNumericLiteral(left) && t.isNumericLiteral(right)) {
                            let result;
                            switch (operator) {
                                case '>':
                                    result = left.value > right.value;
                                    break;
                                case '<':
                                    result = left.value < right.value;
                                    break;
                                case '>=':
                                    result = left.value >= right.value;
                                    break;
                                case '<=':
                                    result = left.value <= right.value;
                                    break;
                                case '===':
                                case '==':
                                    result = left.value === right.value;
                                    break;
                                case '!==':
                                case '!=':
                                    result = left.value !== right.value;
                                    break;
                            }
                            if (result !== undefined) {
                                if (result) {
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
                                removed++;
                                return;
                            }
                        }
                    }
                    if (t.isBinaryExpression(test) && (test.operator === '===' || test.operator === '==')) {
                        const left = test.left;
                        const right = test.right;
                        if (t.isBinaryExpression(left) && left.operator === '*' &&
                            t.isNumericLiteral(right) && right.value === 0) {
                            if ((t.isNumericLiteral(left.left) && left.left.value === 0) ||
                                (t.isNumericLiteral(left.right) && left.right.value === 0)) {
                                path.replaceWith(path.node.consequent);
                                removed++;
                                return;
                            }
                        }
                    }
                },
            });
            if (removed > 0) {
                logger.info(`Removed ${removed} opaque predicates`);
                return generate(ast, { comments: true, compact: false }).code;
            }
            return code;
        }
        catch (error) {
            logger.error('Failed to remove opaque predicates:', error);
            return code;
        }
    }
    async llmCleanup(code, techniques) {
        if (!this.llm)
            return null;
        try {
            const codeSnippet = code.length > 3000 ? code.substring(0, 3000) + '\n\n// ... (code truncated)' : code;
            const prompt = `# Code Cleanup Task

## Detected Obfuscation Techniques
${techniques.map(t => `- ${t}`).join('\n')}

## Deobfuscated Code (needs cleanup)
\`\`\`javascript
${codeSnippet}
\`\`\`

## Your Task
Clean up and improve this deobfuscated JavaScript code:

1. **Variable Naming**: Rename variables to meaningful names based on their usage
   - Avoid generic names like 'a', 'b', 'temp'
   - Use descriptive names like 'userConfig', 'apiEndpoint', 'responseData'

2. **Code Structure**: Improve readability
   - Remove unnecessary parentheses and brackets
   - Simplify complex expressions
   - Extract magic numbers to named constants

3. **Comments**: Add brief comments for:
   - Complex logic or algorithms
   - Non-obvious functionality
   - Important data structures

4. **Consistency**: Ensure consistent code style
   - Use consistent indentation
   - Follow JavaScript best practices

## Important Rules
- Preserve ALL original functionality
- Do NOT remove any functional code
- Do NOT change the program logic
- Output ONLY valid JavaScript code
- Do NOT add explanations outside the code

## Output Format
Return only the cleaned JavaScript code without markdown formatting.`;
            const response = await this.llm.chat([
                {
                    role: 'system',
                    content: `# Role
You are an expert JavaScript code reviewer and refactoring specialist with expertise in:
- Code readability and maintainability improvement
- Semantic variable naming based on usage context
- Code smell detection and refactoring
- JavaScript best practices (ES6+, clean code principles)
- Preserving exact program functionality during refactoring

# Task
Clean up and improve deobfuscated JavaScript code while preserving 100% of its functionality.

# Refactoring Principles
1. **Semantic Naming**: Infer variable purpose from usage patterns
   - API calls → apiClient, fetchData, apiResponse
   - DOM elements → userInput, submitButton, errorMessage
   - Crypto operations → encryptedData, decryptionKey, hashValue
   - Loops/counters → index, itemCount, currentPage

2. **Code Simplification**: Remove obfuscation artifacts
   - Unnecessary IIFEs and closures
   - Redundant variable assignments
   - Complex ternary chains → if-else
   - Magic numbers → named constants

3. **Structure Improvement**: Enhance readability
   - Extract repeated code to functions
   - Group related operations
   - Consistent indentation and spacing
   - Logical code organization

# Critical Constraints
- **NEVER** change program logic or behavior
- **NEVER** remove functional code (even if it looks redundant)
- **NEVER** add new functionality
- **ONLY** improve naming, structure, and readability
- Output must be syntactically valid JavaScript
- Preserve all side effects and edge cases

# Output Format
Return ONLY the cleaned JavaScript code (no markdown, no explanations).`
                },
                { role: 'user', content: prompt },
            ], {
                temperature: 0.15,
                maxTokens: 3000,
            });
            const cleanedCode = this.extractCodeFromLLMResponse(response.content);
            if (this.isValidJavaScript(cleanedCode)) {
                logger.success('LLM cleanup succeeded');
                return cleanedCode;
            }
            else {
                logger.warn('LLM cleanup produced invalid JavaScript');
                return null;
            }
        }
        catch (error) {
            logger.warn('LLM cleanup failed', error);
            return null;
        }
    }
    normalizeCode(code) {
        code = code.replace(/\s+/g, ' ');
        code = code.replace(/\/\*[\s\S]*?\*\//g, '');
        code = code.replace(/\/\/.*/g, '');
        return code.trim();
    }
    detectStringEncoding(code) {
        const patterns = [
            /\\x[0-9a-f]{2}/i,
            /\\u[0-9a-f]{4}/i,
            /String\.fromCharCode/i,
            /atob\(/i,
        ];
        return patterns.some(p => p.test(code));
    }
    decodeStrings(code) {
        logger.info('Decoding strings...');
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            let decoded = 0;
            traverse(ast, {
                CallExpression(path) {
                    if (t.isMemberExpression(path.node.callee) &&
                        t.isIdentifier(path.node.callee.object, { name: 'String' }) &&
                        t.isIdentifier(path.node.callee.property, { name: 'fromCharCode' })) {
                        const allNumbers = path.node.arguments.every((arg) => t.isNumericLiteral(arg));
                        if (allNumbers) {
                            const charCodes = path.node.arguments.map((arg) => arg.value);
                            const decodedString = String.fromCharCode(...charCodes);
                            path.replaceWith(t.stringLiteral(decodedString));
                            decoded++;
                        }
                    }
                },
            });
            if (decoded > 0) {
                logger.info(`Decoded ${decoded} string expressions`);
                return generate(ast, { comments: false, compact: false }).code;
            }
            return code;
        }
        catch (error) {
            logger.error('Failed to decode strings:', error);
            return code;
        }
    }
    applyASTOptimizations(code) {
        logger.info('Applying AST optimizations...');
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            let optimized = 0;
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
                                result = Math.pow(left.value, right.value);
                                break;
                        }
                        if (result !== undefined) {
                            path.replaceWith(t.numericLiteral(result));
                            optimized++;
                        }
                    }
                },
                LogicalExpression(path) {
                    const { left, right, operator } = path.node;
                    if (operator === '&&' && t.isBooleanLiteral(left) && left.value === true) {
                        path.replaceWith(right);
                        optimized++;
                    }
                    if (operator === '||' && t.isBooleanLiteral(left) && left.value === false) {
                        path.replaceWith(right);
                        optimized++;
                    }
                },
                EmptyStatement(path) {
                    path.remove();
                    optimized++;
                },
                ConditionalExpression(path) {
                    const { test, consequent, alternate } = path.node;
                    if (t.isBooleanLiteral(test) && test.value === true) {
                        path.replaceWith(consequent);
                        optimized++;
                    }
                    if (t.isBooleanLiteral(test) && test.value === false) {
                        path.replaceWith(alternate);
                        optimized++;
                    }
                },
            });
            if (optimized > 0) {
                logger.info(`Applied ${optimized} AST optimizations`);
                return generate(ast, { comments: true, compact: false }).code;
            }
            return code;
        }
        catch (error) {
            logger.error('Failed to apply AST optimizations:', error);
            return code;
        }
    }
    calculateConfidence(techniques, warnings, code) {
        let confidence = 0.3;
        const techniqueBonus = Math.min(techniques.length * 0.12, 0.5);
        confidence += techniqueBonus;
        const warningPenalty = warnings.length * 0.08;
        confidence -= warningPenalty;
        const highConfidenceTechniques = [
            'invisible-unicode',
            'string-array-rotation',
            'dead-code-injection',
            'opaque-predicates',
            'string-encoding',
            'ast-optimized',
        ];
        const highConfidenceCount = techniques.filter(t => highConfidenceTechniques.some(ht => t.includes(ht))).length;
        confidence += highConfidenceCount * 0.05;
        if (techniques.some(t => t.includes('vm-protection'))) {
            confidence -= 0.15;
        }
        if (techniques.some(t => t.includes('control-flow-flattening'))) {
            confidence -= 0.05;
        }
        const complexity = this.estimateCodeComplexity(code);
        if (complexity < 10) {
            confidence += 0.1;
        }
        else if (complexity > 100) {
            confidence -= 0.1;
        }
        return Math.max(0.1, Math.min(0.95, confidence));
    }
    estimateCodeComplexity(code) {
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            let complexity = 0;
            traverse(ast, {
                FunctionDeclaration() { complexity += 2; },
                FunctionExpression() { complexity += 2; },
                ArrowFunctionExpression() { complexity += 2; },
                IfStatement() { complexity += 1; },
                SwitchStatement() { complexity += 2; },
                ConditionalExpression() { complexity += 1; },
                WhileStatement() { complexity += 2; },
                ForStatement() { complexity += 2; },
                DoWhileStatement() { complexity += 2; },
                TryStatement() { complexity += 3; },
            });
            return complexity;
        }
        catch {
            return 100;
        }
    }
}
//# sourceMappingURL=AdvancedDeobfuscator.js.map

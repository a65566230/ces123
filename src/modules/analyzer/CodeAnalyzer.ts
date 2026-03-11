// @ts-nocheck

import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { logger } from '../../utils/logger.js';
export class CodeAnalyzer {
    llm;
    constructor(llm) {
        this.llm = llm;
    }
    async understand(options) {
        logger.info('Starting code understanding...');
        const startTime = Date.now();
        try {
            const { code, context, focus = 'all' } = options;
            const structure = await this.analyzeStructure(code);
            logger.debug('Code structure analyzed');
            const aiAnalysis = await this.aiAnalyze(code, focus);
            logger.debug('AI analysis completed');
            const techStack = this.detectTechStack(code, aiAnalysis);
            logger.debug('Tech stack detected');
            const businessLogic = this.extractBusinessLogic(aiAnalysis, context);
            logger.debug('Business logic extracted');
            const dataFlow = await this.analyzeDataFlow(code);
            logger.debug('Data flow analyzed');
            const securityRisks = this.identifySecurityRisks(code, aiAnalysis);
            logger.debug('Security risks identified');
            const { patterns, antiPatterns } = this.detectCodePatterns(code);
            logger.debug(`Detected ${patterns.length} patterns and ${antiPatterns.length} anti-patterns`);
            const complexityMetrics = this.analyzeComplexityMetrics(code);
            logger.debug('Complexity metrics calculated');
            const qualityScore = this.calculateQualityScore(structure, securityRisks, aiAnalysis, complexityMetrics, antiPatterns);
            const duration = Date.now() - startTime;
            logger.success(`Code understanding completed in ${duration}ms`);
            return {
                structure,
                techStack,
                businessLogic,
                dataFlow,
                securityRisks,
                qualityScore,
                codePatterns: patterns,
                antiPatterns,
                complexityMetrics,
            };
        }
        catch (error) {
            logger.error('Code understanding failed', error);
            throw error;
        }
    }
    async analyzeStructure(code) {
        const functions = [];
        const classes = [];
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            const self = this;
            traverse(ast, {
                FunctionDeclaration(path) {
                    const node = path.node;
                    functions.push({
                        name: node.id?.name || 'anonymous',
                        params: node.params.map((p) => (p.type === 'Identifier' ? p.name : 'unknown')),
                        location: {
                            file: 'current',
                            line: node.loc?.start.line || 0,
                            column: node.loc?.start.column,
                        },
                        complexity: self.calculateComplexity(path),
                    });
                },
                FunctionExpression(path) {
                    const node = path.node;
                    const parent = path.parent;
                    let name = 'anonymous';
                    if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
                        name = parent.id.name;
                    }
                    else if (parent.type === 'AssignmentExpression' && parent.left.type === 'Identifier') {
                        name = parent.left.name;
                    }
                    functions.push({
                        name,
                        params: node.params.map((p) => (p.type === 'Identifier' ? p.name : 'unknown')),
                        location: {
                            file: 'current',
                            line: node.loc?.start.line || 0,
                            column: node.loc?.start.column,
                        },
                        complexity: self.calculateComplexity(path),
                    });
                },
                ArrowFunctionExpression(path) {
                    const node = path.node;
                    const parent = path.parent;
                    let name = 'arrow';
                    if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
                        name = parent.id.name;
                    }
                    functions.push({
                        name,
                        params: node.params.map((p) => (p.type === 'Identifier' ? p.name : 'unknown')),
                        location: {
                            file: 'current',
                            line: node.loc?.start.line || 0,
                            column: node.loc?.start.column,
                        },
                        complexity: self.calculateComplexity(path),
                    });
                },
                ClassDeclaration(path) {
                    const node = path.node;
                    const methods = [];
                    const properties = [];
                    path.traverse({
                        ClassMethod(methodPath) {
                            const method = methodPath.node;
                            methods.push({
                                name: method.key.type === 'Identifier' ? method.key.name : 'unknown',
                                params: method.params.map((p) => (p.type === 'Identifier' ? p.name : 'unknown')),
                                location: {
                                    file: 'current',
                                    line: method.loc?.start.line || 0,
                                    column: method.loc?.start.column,
                                },
                                complexity: 1,
                            });
                        },
                        ClassProperty(propertyPath) {
                            const property = propertyPath.node;
                            if (property.key.type === 'Identifier') {
                                properties.push({
                                    name: property.key.name,
                                    type: undefined,
                                    value: undefined,
                                });
                            }
                        },
                    });
                    classes.push({
                        name: node.id?.name || 'anonymous',
                        methods,
                        properties,
                        location: {
                            file: 'current',
                            line: node.loc?.start.line || 0,
                            column: node.loc?.start.column,
                        },
                    });
                },
            });
        }
        catch (error) {
            logger.warn('Failed to parse code structure', error);
        }
        const modules = this.analyzeModules(code);
        const callGraph = this.buildCallGraph(functions, code);
        return {
            functions,
            classes,
            modules,
            callGraph,
        };
    }
    async aiAnalyze(code, focus) {
        try {
            const messages = this.llm.generateCodeAnalysisPrompt(code, focus);
            const response = await this.llm.chat(messages, { temperature: 0.3, maxTokens: 2000 });
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return { rawAnalysis: response.content };
        }
        catch (error) {
            logger.warn('AI analysis failed, using fallback', error);
            return {};
        }
    }
    detectTechStack(code, aiAnalysis) {
        const techStack = {
            other: [],
        };
        if (aiAnalysis.techStack && typeof aiAnalysis.techStack === 'object') {
            const ts = aiAnalysis.techStack;
            techStack.framework = ts.framework;
            techStack.bundler = ts.bundler;
            if (Array.isArray(ts.libraries)) {
                techStack.other = ts.libraries;
            }
        }
        if (code.includes('React.') || code.includes('useState') || code.includes('useEffect')) {
            techStack.framework = 'React';
        }
        else if (code.includes('Vue.') || code.includes('createApp')) {
            techStack.framework = 'Vue';
        }
        else if (code.includes('@angular/')) {
            techStack.framework = 'Angular';
        }
        if (code.includes('__webpack_require__')) {
            techStack.bundler = 'Webpack';
        }
        const cryptoLibs = [];
        if (code.includes('CryptoJS'))
            cryptoLibs.push('CryptoJS');
        if (code.includes('JSEncrypt'))
            cryptoLibs.push('JSEncrypt');
        if (code.includes('crypto-js'))
            cryptoLibs.push('crypto-js');
        if (cryptoLibs.length > 0) {
            techStack.cryptoLibrary = cryptoLibs;
        }
        return techStack;
    }
    extractBusinessLogic(aiAnalysis, context) {
        const businessLogic = {
            mainFeatures: [],
            entities: [],
            rules: [],
            dataModel: {},
        };
        if (aiAnalysis.businessLogic && typeof aiAnalysis.businessLogic === 'object') {
            const bl = aiAnalysis.businessLogic;
            if (Array.isArray(bl.mainFeatures)) {
                businessLogic.mainFeatures = bl.mainFeatures;
            }
            if (typeof bl.dataFlow === 'string') {
                businessLogic.rules.push(bl.dataFlow);
            }
        }
        if (context) {
            businessLogic.dataModel = { ...businessLogic.dataModel, ...context };
        }
        return businessLogic;
    }
    analyzeModules(code) {
        const modules = [];
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            const imports = [];
            const exports = [];
            traverse(ast, {
                ImportDeclaration(path) {
                    imports.push(path.node.source.value);
                },
                ExportNamedDeclaration(path) {
                    if (path.node.source) {
                        exports.push(path.node.source.value);
                    }
                },
                ExportDefaultDeclaration() {
                    exports.push('default');
                },
            });
            if (imports.length > 0 || exports.length > 0) {
                modules.push({
                    name: 'current',
                    imports,
                    exports,
                });
            }
        }
        catch (error) {
            logger.warn('Module analysis failed', error);
        }
        return modules;
    }
    buildCallGraph(functions, code) {
        const nodes = functions.map((fn) => ({
            id: fn.name,
            name: fn.name,
            type: 'function',
        }));
        const edges = [];
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            let currentFunction = '';
            traverse(ast, {
                FunctionDeclaration(path) {
                    currentFunction = path.node.id?.name || '';
                },
                FunctionExpression(path) {
                    const parent = path.parent;
                    if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
                        currentFunction = parent.id.name;
                    }
                },
                CallExpression(path) {
                    if (currentFunction) {
                        const callee = path.node.callee;
                        let calledFunction = '';
                        if (callee.type === 'Identifier') {
                            calledFunction = callee.name;
                        }
                        else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
                            calledFunction = callee.property.name;
                        }
                        if (calledFunction && functions.some((f) => f.name === calledFunction)) {
                            edges.push({
                                from: currentFunction,
                                to: calledFunction,
                            });
                        }
                    }
                },
            });
        }
        catch (error) {
            logger.warn('Call graph construction failed', error);
        }
        return { nodes, edges };
    }
    calculateComplexity(path) {
        let complexity = 1;
        const anyPath = path;
        if (anyPath.traverse) {
            anyPath.traverse({
                IfStatement() {
                    complexity++;
                },
                SwitchCase() {
                    complexity++;
                },
                ForStatement() {
                    complexity++;
                },
                WhileStatement() {
                    complexity++;
                },
                DoWhileStatement() {
                    complexity++;
                },
                ConditionalExpression() {
                    complexity++;
                },
                LogicalExpression(logicalPath) {
                    if (logicalPath.node.operator === '&&' || logicalPath.node.operator === '||') {
                        complexity++;
                    }
                },
                CatchClause() {
                    complexity++;
                },
            });
        }
        return complexity;
    }
    async analyzeDataFlow(code) {
        const graph = { nodes: [], edges: [] };
        const sources = [];
        const sinks = [];
        const taintPaths = [];
        const taintMap = new Map();
        const sanitizers = new Set([
            'encodeURIComponent', 'encodeURI', 'escape', 'decodeURIComponent', 'decodeURI',
            'htmlentities', 'htmlspecialchars', 'escapeHtml', 'escapeHTML',
            'he.encode', 'he.escape',
            'validator.escape', 'validator.unescape', 'validator.stripLow',
            'validator.blacklist', 'validator.whitelist', 'validator.trim',
            'validator.isEmail', 'validator.isURL', 'validator.isInt',
            'DOMPurify.sanitize', 'DOMPurify.addHook',
            'crypto.encrypt', 'crypto.hash', 'crypto.createHash', 'crypto.createHmac',
            'CryptoJS.AES.encrypt', 'CryptoJS.SHA256', 'CryptoJS.MD5',
            'bcrypt.hash', 'bcrypt.compare',
            'btoa', 'atob', 'Buffer.from',
            'db.prepare', 'db.query', 'mysql.escape', 'pg.query',
            'xss', 'sanitizeHtml',
            'parseInt', 'parseFloat', 'Number', 'String',
            'JSON.stringify', 'JSON.parse',
            'String.prototype.replace', 'String.prototype.trim',
            'Array.prototype.filter', 'Array.prototype.map',
        ]);
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            const self = this;
            traverse(ast, {
                CallExpression(path) {
                    const callee = path.node.callee;
                    const line = path.node.loc?.start.line || 0;
                    if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
                        const methodName = callee.property.name;
                        if (['fetch', 'ajax', 'get', 'post', 'request', 'axios'].includes(methodName)) {
                            const sourceId = `source-network-${line}`;
                            sources.push({ type: 'network', location: { file: 'current', line } });
                            graph.nodes.push({
                                id: sourceId,
                                name: `${methodName}()`,
                                type: 'source',
                                location: { file: 'current', line },
                            });
                            const parent = path.parent;
                            if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
                                taintMap.set(parent.id.name, { sourceType: 'network', sourceLine: line });
                            }
                        }
                        else if (['querySelector', 'getElementById', 'getElementsByClassName', 'getElementsByTagName'].includes(methodName)) {
                            const sourceId = `source-dom-${line}`;
                            sources.push({ type: 'user_input', location: { file: 'current', line } });
                            graph.nodes.push({
                                id: sourceId,
                                name: `${methodName}()`,
                                type: 'source',
                                location: { file: 'current', line },
                            });
                        }
                    }
                    if (t.isIdentifier(callee)) {
                        const funcName = callee.name;
                        if (['eval', 'Function', 'setTimeout', 'setInterval'].includes(funcName)) {
                            const sinkId = `sink-eval-${line}`;
                            sinks.push({ type: 'eval', location: { file: 'current', line } });
                            graph.nodes.push({
                                id: sinkId,
                                name: `${funcName}()`,
                                type: 'sink',
                                location: { file: 'current', line },
                            });
                            self.checkTaintedArguments(path.node.arguments, taintMap, taintPaths, funcName, line);
                        }
                    }
                    if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
                        const methodName = callee.property.name;
                        if (['write', 'writeln'].includes(methodName) &&
                            t.isIdentifier(callee.object) && callee.object.name === 'document') {
                            const sinkId = `sink-document-write-${line}`;
                            sinks.push({ type: 'xss', location: { file: 'current', line } });
                            graph.nodes.push({
                                id: sinkId,
                                name: `document.${methodName}()`,
                                type: 'sink',
                                location: { file: 'current', line },
                            });
                            self.checkTaintedArguments(path.node.arguments, taintMap, taintPaths, methodName, line);
                        }
                        if (['query', 'execute', 'exec', 'run'].includes(methodName)) {
                            const sinkId = `sink-sql-${line}`;
                            sinks.push({ type: 'sql-injection', location: { file: 'current', line } });
                            graph.nodes.push({
                                id: sinkId,
                                name: `${methodName}() (SQL)`,
                                type: 'sink',
                                location: { file: 'current', line },
                            });
                            self.checkTaintedArguments(path.node.arguments, taintMap, taintPaths, methodName, line);
                        }
                        if (['exec', 'spawn', 'execSync', 'spawnSync'].includes(methodName)) {
                            const sinkId = `sink-command-${line}`;
                            sinks.push({ type: 'other', location: { file: 'current', line } });
                            graph.nodes.push({
                                id: sinkId,
                                name: `${methodName}() (Command)`,
                                type: 'sink',
                                location: { file: 'current', line },
                            });
                            self.checkTaintedArguments(path.node.arguments, taintMap, taintPaths, methodName, line);
                        }
                        if (['readFile', 'writeFile', 'readFileSync', 'writeFileSync', 'open'].includes(methodName)) {
                            const sinkId = `sink-file-${line}`;
                            sinks.push({ type: 'other', location: { file: 'current', line } });
                            graph.nodes.push({
                                id: sinkId,
                                name: `${methodName}() (File)`,
                                type: 'sink',
                                location: { file: 'current', line },
                            });
                            self.checkTaintedArguments(path.node.arguments, taintMap, taintPaths, methodName, line);
                        }
                    }
                },
                MemberExpression(path) {
                    const obj = path.node.object;
                    const prop = path.node.property;
                    const line = path.node.loc?.start.line || 0;
                    if (t.isIdentifier(obj) && obj.name === 'location' && t.isIdentifier(prop)) {
                        if (['href', 'search', 'hash', 'pathname'].includes(prop.name)) {
                            const sourceId = `source-url-${line}`;
                            sources.push({ type: 'user_input', location: { file: 'current', line } });
                            graph.nodes.push({
                                id: sourceId,
                                name: `location.${prop.name}`,
                                type: 'source',
                                location: { file: 'current', line },
                            });
                            const parent = path.parent;
                            if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
                                taintMap.set(parent.id.name, { sourceType: 'url', sourceLine: line });
                            }
                        }
                    }
                    if (t.isIdentifier(obj) && obj.name === 'document' && t.isIdentifier(prop) && prop.name === 'cookie') {
                        const sourceId = `source-cookie-${line}`;
                        sources.push({ type: 'storage', location: { file: 'current', line } });
                        graph.nodes.push({
                            id: sourceId,
                            name: 'document.cookie',
                            type: 'source',
                            location: { file: 'current', line },
                        });
                    }
                    if (t.isIdentifier(obj) && ['localStorage', 'sessionStorage'].includes(obj.name)) {
                        const sourceId = `source-storage-${line}`;
                        sources.push({ type: 'storage', location: { file: 'current', line } });
                        graph.nodes.push({
                            id: sourceId,
                            name: `${obj.name}.getItem()`,
                            type: 'source',
                            location: { file: 'current', line },
                        });
                    }
                    if (t.isIdentifier(obj) && obj.name === 'window' &&
                        t.isIdentifier(prop) && prop.name === 'name') {
                        const sourceId = `source-window-name-${line}`;
                        sources.push({ type: 'user_input', location: { file: 'current', line } });
                        graph.nodes.push({
                            id: sourceId,
                            name: 'window.name',
                            type: 'source',
                            location: { file: 'current', line },
                        });
                    }
                    if (t.isIdentifier(obj) && obj.name === 'event' &&
                        t.isIdentifier(prop) && prop.name === 'data') {
                        const sourceId = `source-postmessage-${line}`;
                        sources.push({ type: 'network', location: { file: 'current', line } });
                        graph.nodes.push({
                            id: sourceId,
                            name: 'event.data (postMessage)',
                            type: 'source',
                            location: { file: 'current', line },
                        });
                    }
                    if (t.isIdentifier(obj) && obj.name === 'message' &&
                        t.isIdentifier(prop) && prop.name === 'data') {
                        const sourceId = `source-websocket-${line}`;
                        sources.push({ type: 'network', location: { file: 'current', line } });
                        graph.nodes.push({
                            id: sourceId,
                            name: 'WebSocket message.data',
                            type: 'source',
                            location: { file: 'current', line },
                        });
                    }
                },
                AssignmentExpression(path) {
                    const left = path.node.left;
                    const right = path.node.right;
                    const line = path.node.loc?.start.line || 0;
                    if (t.isMemberExpression(left) && t.isIdentifier(left.property)) {
                        const propName = left.property.name;
                        if (['innerHTML', 'outerHTML'].includes(propName)) {
                            const sinkId = `sink-dom-${line}`;
                            sinks.push({ type: 'xss', location: { file: 'current', line } });
                            graph.nodes.push({
                                id: sinkId,
                                name: propName,
                                type: 'sink',
                                location: { file: 'current', line },
                            });
                            if (t.isIdentifier(right) && taintMap.has(right.name)) {
                                const taintInfo = taintMap.get(right.name);
                                taintPaths.push({
                                    source: { type: taintInfo.sourceType, location: { file: 'current', line: taintInfo.sourceLine } },
                                    sink: { type: 'xss', location: { file: 'current', line } },
                                    path: [
                                        { file: 'current', line: taintInfo.sourceLine },
                                        { file: 'current', line },
                                    ],
                                });
                            }
                        }
                    }
                },
            });
            traverse(ast, {
                VariableDeclarator(path) {
                    const id = path.node.id;
                    const init = path.node.init;
                    if (t.isIdentifier(id) && init) {
                        if (t.isCallExpression(init) && self.checkSanitizer(init, sanitizers)) {
                            const arg = init.arguments[0];
                            if (t.isIdentifier(arg) && taintMap.has(arg.name)) {
                                logger.debug(`Taint cleaned by sanitizer: ${arg.name} -> ${id.name}`);
                                return;
                            }
                        }
                        if (t.isIdentifier(init) && taintMap.has(init.name)) {
                            const taintInfo = taintMap.get(init.name);
                            taintMap.set(id.name, taintInfo);
                        }
                        else if (t.isBinaryExpression(init)) {
                            const leftTainted = t.isIdentifier(init.left) && taintMap.has(init.left.name);
                            const rightTainted = t.isIdentifier(init.right) && taintMap.has(init.right.name);
                            if (leftTainted || rightTainted) {
                                const taintInfo = leftTainted ? taintMap.get(init.left.name) : taintMap.get(init.right.name);
                                taintMap.set(id.name, taintInfo);
                            }
                        }
                        else if (t.isCallExpression(init)) {
                            const arg = init.arguments[0];
                            if (t.isIdentifier(arg) && taintMap.has(arg.name)) {
                                const taintInfo = taintMap.get(arg.name);
                                taintMap.set(id.name, taintInfo);
                            }
                        }
                    }
                },
                AssignmentExpression(path) {
                    const left = path.node.left;
                    const right = path.node.right;
                    if (t.isIdentifier(left) && t.isIdentifier(right) && taintMap.has(right.name)) {
                        const taintInfo = taintMap.get(right.name);
                        taintMap.set(left.name, taintInfo);
                    }
                },
            });
        }
        catch (error) {
            logger.warn('Data flow analysis failed', error);
        }
        if (taintPaths.length > 0 && this.llm) {
            try {
                await this.enhanceTaintAnalysisWithLLM(code, sources, sinks, taintPaths);
            }
            catch (error) {
                logger.warn('LLM-enhanced taint analysis failed', error);
            }
        }
        return {
            graph,
            sources,
            sinks,
            taintPaths,
        };
    }
    async enhanceTaintAnalysisWithLLM(code, sources, sinks, taintPaths) {
        if (!this.llm || taintPaths.length === 0)
            return;
        try {
            const sourcesList = sources.map(s => `${s.type} at line ${s.location.line}`);
            const sinksList = sinks.map(s => `${s.type} at line ${s.location.line}`);
            const messages = this.llm.generateTaintAnalysisPrompt(code.length > 4000 ? code.substring(0, 4000) : code, sourcesList, sinksList);
            const response = await this.llm.chat(messages, {
                temperature: 0.2,
                maxTokens: 2000,
            });
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const llmResult = JSON.parse(jsonMatch[0]);
                if (Array.isArray(llmResult.taintPaths)) {
                    logger.info(`LLM identified ${llmResult.taintPaths.length} additional taint paths`);
                    llmResult.taintPaths.forEach((path) => {
                        const exists = taintPaths.some(p => p.source.location.line === path.source?.location?.line &&
                            p.sink.location.line === path.sink?.location?.line);
                        if (!exists && path.source && path.sink) {
                            taintPaths.push({
                                source: path.source,
                                sink: path.sink,
                                path: path.path || [],
                            });
                        }
                    });
                }
            }
        }
        catch (error) {
            logger.debug('LLM taint analysis enhancement failed', error);
        }
    }
    checkTaintedArguments(args, taintMap, taintPaths, _funcName, line) {
        args.forEach((arg) => {
            if (t.isIdentifier(arg) && taintMap.has(arg.name)) {
                const taintInfo = taintMap.get(arg.name);
                taintPaths.push({
                    source: {
                        type: taintInfo.sourceType,
                        location: { file: 'current', line: taintInfo.sourceLine },
                    },
                    sink: {
                        type: 'eval',
                        location: { file: 'current', line },
                    },
                    path: [
                        { file: 'current', line: taintInfo.sourceLine },
                        { file: 'current', line },
                    ],
                });
            }
        });
    }
    identifySecurityRisks(code, aiAnalysis) {
        const risks = [];
        if (Array.isArray(aiAnalysis.securityRisks)) {
            aiAnalysis.securityRisks.forEach((risk) => {
                if (typeof risk === 'object' && risk !== null) {
                    const r = risk;
                    risks.push({
                        type: r.type || 'other',
                        severity: r.severity || 'low',
                        location: { file: 'current', line: r.location?.line || 0 },
                        description: r.description || '',
                        recommendation: r.recommendation || '',
                    });
                }
            });
        }
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            traverse(ast, {
                AssignmentExpression(path) {
                    const left = path.node.left;
                    const line = path.node.loc?.start.line || 0;
                    if (t.isMemberExpression(left) && t.isIdentifier(left.property)) {
                        const propName = left.property.name;
                        if (['innerHTML', 'outerHTML', 'insertAdjacentHTML'].includes(propName)) {
                            risks.push({
                                type: 'xss',
                                severity: 'high',
                                location: { file: 'current', line },
                                description: `Potential XSS vulnerability: Direct assignment to ${propName} without sanitization`,
                                recommendation: 'Use textContent for plain text, or DOMPurify.sanitize() for HTML content',
                            });
                        }
                        if (propName === 'write' && t.isIdentifier(left.object) && left.object.name === 'document') {
                            risks.push({
                                type: 'xss',
                                severity: 'high',
                                location: { file: 'current', line },
                                description: 'Dangerous use of document.write() which can lead to XSS',
                                recommendation: 'Use modern DOM manipulation methods instead',
                            });
                        }
                    }
                },
                CallExpression(path) {
                    const callee = path.node.callee;
                    const line = path.node.loc?.start.line || 0;
                    if (t.isIdentifier(callee)) {
                        if (callee.name === 'eval') {
                            risks.push({
                                type: 'other',
                                severity: 'critical',
                                location: { file: 'current', line },
                                description: 'Critical: Use of eval() allows arbitrary code execution',
                                recommendation: 'Refactor to avoid eval(). Use JSON.parse() for data, or proper function calls',
                            });
                        }
                        if (callee.name === 'Function') {
                            risks.push({
                                type: 'other',
                                severity: 'critical',
                                location: { file: 'current', line },
                                description: 'Critical: Function constructor allows code injection',
                                recommendation: 'Use regular function declarations or arrow functions',
                            });
                        }
                        if (['setTimeout', 'setInterval'].includes(callee.name)) {
                            const firstArg = path.node.arguments[0];
                            if (t.isStringLiteral(firstArg) || (t.isIdentifier(firstArg) && firstArg.name !== 'function')) {
                                risks.push({
                                    type: 'other',
                                    severity: 'medium',
                                    location: { file: 'current', line },
                                    description: `${callee.name}() with string argument can lead to code injection`,
                                    recommendation: `Use ${callee.name}() with function reference instead of string`,
                                });
                            }
                        }
                    }
                    if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
                        const methodName = callee.property.name;
                        if (['query', 'execute', 'exec', 'run'].includes(methodName)) {
                            const firstArg = path.node.arguments[0];
                            if (t.isBinaryExpression(firstArg) || t.isTemplateLiteral(firstArg)) {
                                risks.push({
                                    type: 'sql-injection',
                                    severity: 'critical',
                                    location: { file: 'current', line },
                                    description: 'Potential SQL injection: Query built with string concatenation',
                                    recommendation: 'Use parameterized queries or prepared statements',
                                });
                            }
                        }
                    }
                },
                MemberExpression(path) {
                    const obj = path.node.object;
                    const prop = path.node.property;
                    const line = path.node.loc?.start.line || 0;
                    if (t.isIdentifier(obj) && obj.name === 'Math' &&
                        t.isIdentifier(prop) && prop.name === 'random') {
                        const parent = path.parent;
                        if (t.isCallExpression(parent) || t.isBinaryExpression(parent)) {
                            risks.push({
                                type: 'other',
                                severity: 'medium',
                                location: { file: 'current', line },
                                description: 'Math.random() is not cryptographically secure',
                                recommendation: 'Use crypto.getRandomValues() or crypto.randomBytes() for security-sensitive operations',
                            });
                        }
                    }
                },
                VariableDeclarator(path) {
                    const id = path.node.id;
                    const init = path.node.init;
                    const line = path.node.loc?.start.line || 0;
                    if (t.isIdentifier(id) && t.isStringLiteral(init)) {
                        const varName = id.name.toLowerCase();
                        const value = init.value;
                        const sensitivePatterns = [
                            { pattern: /(password|passwd|pwd)/i, type: 'password' },
                            { pattern: /(api[_-]?key|apikey)/i, type: 'API key' },
                            { pattern: /(secret|token|auth)/i, type: 'secret' },
                            { pattern: /(private[_-]?key|privatekey)/i, type: 'private key' },
                        ];
                        for (const { pattern, type } of sensitivePatterns) {
                            if (pattern.test(varName) && value.length > 8) {
                                risks.push({
                                    type: 'other',
                                    severity: 'critical',
                                    location: { file: 'current', line },
                                    description: `Hardcoded ${type} detected in source code`,
                                    recommendation: `Store ${type} in environment variables or secure configuration`,
                                });
                                break;
                            }
                        }
                    }
                },
            });
        }
        catch (error) {
            logger.warn('Static security analysis failed', error);
        }
        const uniqueRisks = risks.filter((risk, index, self) => index === self.findIndex((r) => r.type === risk.type && r.location.line === risk.location.line));
        return uniqueRisks;
    }
    calculateQualityScore(structure, securityRisks, aiAnalysis, complexityMetrics, antiPatterns) {
        let score = 100;
        let securityScore = 100;
        securityRisks.forEach((risk) => {
            if (risk.severity === 'critical')
                securityScore -= 20;
            else if (risk.severity === 'high')
                securityScore -= 10;
            else if (risk.severity === 'medium')
                securityScore -= 5;
            else
                securityScore -= 2;
        });
        securityScore = Math.max(0, securityScore);
        let complexityScore = 100;
        if (complexityMetrics) {
            if (complexityMetrics.cyclomaticComplexity > 20)
                complexityScore -= 30;
            else if (complexityMetrics.cyclomaticComplexity > 10)
                complexityScore -= 15;
            else if (complexityMetrics.cyclomaticComplexity > 5)
                complexityScore -= 5;
            if (complexityMetrics.cognitiveComplexity > 15)
                complexityScore -= 20;
            else if (complexityMetrics.cognitiveComplexity > 10)
                complexityScore -= 10;
        }
        else {
            const avgComplexity = structure.functions.reduce((sum, fn) => sum + fn.complexity, 0) / (structure.functions.length || 1);
            if (avgComplexity > 10)
                complexityScore -= 20;
            else if (avgComplexity > 5)
                complexityScore -= 10;
        }
        complexityScore = Math.max(0, complexityScore);
        let maintainabilityScore = complexityMetrics?.maintainabilityIndex || 70;
        let codeSmellScore = 100;
        if (antiPatterns) {
            antiPatterns.forEach((pattern) => {
                if (pattern.severity === 'high')
                    codeSmellScore -= 10;
                else if (pattern.severity === 'medium')
                    codeSmellScore -= 5;
                else
                    codeSmellScore -= 2;
            });
        }
        codeSmellScore = Math.max(0, codeSmellScore);
        let aiScore = 70;
        if (typeof aiAnalysis.qualityScore === 'number') {
            aiScore = aiAnalysis.qualityScore;
        }
        score =
            securityScore * 0.40 +
                complexityScore * 0.25 +
                maintainabilityScore * 0.20 +
                codeSmellScore * 0.15;
        if (typeof aiAnalysis.qualityScore === 'number') {
            score = (score + aiScore) / 2;
        }
        return Math.round(Math.max(0, Math.min(100, score)));
    }
    checkSanitizer(node, sanitizers) {
        const { callee } = node;
        if (t.isIdentifier(callee)) {
            return sanitizers.has(callee.name);
        }
        if (t.isMemberExpression(callee)) {
            const fullName = this.getMemberExpressionName(callee);
            return sanitizers.has(fullName);
        }
        return false;
    }
    getMemberExpressionName(node) {
        const parts = [];
        let current = node;
        while (t.isMemberExpression(current)) {
            if (t.isIdentifier(current.property)) {
                parts.unshift(current.property.name);
            }
            current = current.object;
        }
        if (t.isIdentifier(current)) {
            parts.unshift(current.name);
        }
        return parts.join('.');
    }
    detectCodePatterns(code) {
        const patterns = [];
        const antiPatterns = [];
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            traverse(ast, {
                VariableDeclarator(path) {
                    const init = path.node.init;
                    if (t.isCallExpression(init) &&
                        t.isFunctionExpression(init.callee) &&
                        init.callee.body.body.some(stmt => t.isReturnStatement(stmt) &&
                            t.isObjectExpression(stmt.argument))) {
                        patterns.push({
                            name: 'Singleton Pattern',
                            location: path.node.loc?.start.line || 0,
                            description: 'IIFE returning object (Singleton pattern)',
                        });
                    }
                },
                ClassDeclaration(path) {
                    const methods = path.node.body.body.filter(m => t.isClassMethod(m));
                    const methodNames = methods.map(m => t.isClassMethod(m) && t.isIdentifier(m.key) ? m.key.name : '');
                    if (methodNames.includes('subscribe') &&
                        methodNames.includes('unsubscribe') &&
                        methodNames.includes('notify')) {
                        patterns.push({
                            name: 'Observer Pattern',
                            location: path.node.loc?.start.line || 0,
                            description: 'Class with subscribe/unsubscribe/notify methods',
                        });
                    }
                },
                FunctionDeclaration(path) {
                    const loc = path.node.loc;
                    if (loc) {
                        const lines = loc.end.line - loc.start.line;
                        if (lines > 50) {
                            antiPatterns.push({
                                name: 'Long Function',
                                location: loc.start.line,
                                severity: 'medium',
                                recommendation: `Function is ${lines} lines long. Consider breaking it into smaller functions (max 50 lines)`,
                            });
                        }
                    }
                },
                IfStatement(path) {
                    let depth = 0;
                    let current = path.parentPath;
                    while (current) {
                        if (current.isIfStatement() ||
                            current.isForStatement() ||
                            current.isWhileStatement()) {
                            depth++;
                        }
                        current = current.parentPath;
                    }
                    if (depth > 3) {
                        antiPatterns.push({
                            name: 'Deep Nesting',
                            location: path.node.loc?.start.line || 0,
                            severity: 'medium',
                            recommendation: `Nesting depth is ${depth}. Consider extracting to separate functions or using early returns`,
                        });
                    }
                },
                NumericLiteral(path) {
                    const value = path.node.value;
                    const parent = path.parent;
                    const commonNumbers = [0, 1, -1, 2, 10, 100, 1000];
                    if (commonNumbers.includes(value))
                        return;
                    if (t.isMemberExpression(parent) && parent.property === path.node)
                        return;
                    if (t.isAssignmentPattern(parent))
                        return;
                    antiPatterns.push({
                        name: 'Magic Number',
                        location: path.node.loc?.start.line || 0,
                        severity: 'low',
                        recommendation: `Replace magic number ${value} with a named constant`,
                    });
                },
                CatchClause(path) {
                    const body = path.node.body.body;
                    if (body.length === 0) {
                        antiPatterns.push({
                            name: 'Empty Catch Block',
                            location: path.node.loc?.start.line || 0,
                            severity: 'high',
                            recommendation: 'Empty catch block swallows errors. Add proper error handling or logging',
                        });
                    }
                },
                VariableDeclaration(path) {
                    if (path.node.kind === 'var') {
                        antiPatterns.push({
                            name: 'Use of var',
                            location: path.node.loc?.start.line || 0,
                            severity: 'low',
                            recommendation: 'Use let or const instead of var for better scoping',
                        });
                    }
                },
            });
            const duplicates = this.detectDuplicateCode(ast);
            duplicates.forEach(dup => {
                antiPatterns.push({
                    name: 'Duplicate Code',
                    location: dup.location,
                    severity: 'medium',
                    recommendation: `Duplicate code found at lines ${dup.location} and ${dup.duplicateLocation}. Extract into a reusable function.`,
                });
            });
        }
        catch (error) {
            logger.warn('Code pattern detection failed', error);
        }
        return { patterns, antiPatterns };
    }
    analyzeComplexityMetrics(code) {
        let cyclomaticComplexity = 1;
        let cognitiveComplexity = 0;
        let operators = 0;
        let operands = 0;
        const uniqueOperators = new Set();
        const uniqueOperands = new Set();
        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['jsx', 'typescript'],
            });
            let nestingLevel = 0;
            traverse(ast, {
                IfStatement() { cyclomaticComplexity++; },
                SwitchCase() { cyclomaticComplexity++; },
                ForStatement() { cyclomaticComplexity++; },
                WhileStatement() { cyclomaticComplexity++; },
                DoWhileStatement() { cyclomaticComplexity++; },
                ConditionalExpression() { cyclomaticComplexity++; },
                LogicalExpression(path) {
                    if (path.node.operator === '&&' || path.node.operator === '||') {
                        cyclomaticComplexity++;
                    }
                },
                CatchClause() { cyclomaticComplexity++; },
                'IfStatement|ForStatement|WhileStatement|DoWhileStatement': {
                    enter() {
                        nestingLevel++;
                        cognitiveComplexity += nestingLevel;
                    },
                    exit() {
                        nestingLevel--;
                    },
                },
                BinaryExpression(path) {
                    operators++;
                    uniqueOperators.add(path.node.operator);
                },
                UnaryExpression(path) {
                    operators++;
                    uniqueOperators.add(path.node.operator);
                },
                Identifier(path) {
                    operands++;
                    uniqueOperands.add(path.node.name);
                },
                NumericLiteral(path) {
                    operands++;
                    uniqueOperands.add(String(path.node.value));
                },
                StringLiteral(path) {
                    operands++;
                    uniqueOperands.add(path.node.value);
                },
            });
        }
        catch (error) {
            logger.warn('Complexity metrics calculation failed', error);
        }
        const n1 = uniqueOperators.size;
        const n2 = uniqueOperands.size;
        const N1 = operators;
        const N2 = operands;
        const vocabulary = n1 + n2;
        const length = N1 + N2;
        const difficulty = (n1 / 2) * (N2 / (n2 || 1));
        const effort = difficulty * length;
        const volume = length * Math.log2(vocabulary || 1);
        const loc = code.split('\n').length;
        const maintainabilityIndex = Math.max(0, 171 - 5.2 * Math.log(volume || 1) - 0.23 * cyclomaticComplexity - 16.2 * Math.log(loc));
        return {
            cyclomaticComplexity,
            cognitiveComplexity,
            maintainabilityIndex: Math.round(maintainabilityIndex),
            halsteadMetrics: {
                vocabulary,
                length,
                difficulty: Math.round(difficulty * 100) / 100,
                effort: Math.round(effort),
            },
        };
    }
    detectDuplicateCode(ast) {
        const duplicates = [];
        const codeBlocks = [];
        try {
            const self = this;
            traverse(ast, {
                FunctionDeclaration(path) {
                    const hash = self.computeASTHash(path.node);
                    const normalized = self.normalizeCode(path.node);
                    codeBlocks.push({
                        node: path.node,
                        hash,
                        location: path.node.loc?.start.line || 0,
                        normalizedCode: normalized,
                    });
                },
                FunctionExpression(path) {
                    const hash = self.computeASTHash(path.node);
                    const normalized = self.normalizeCode(path.node);
                    codeBlocks.push({
                        node: path.node,
                        hash,
                        location: path.node.loc?.start.line || 0,
                        normalizedCode: normalized,
                    });
                },
                ArrowFunctionExpression(path) {
                    const hash = self.computeASTHash(path.node);
                    const normalized = self.normalizeCode(path.node);
                    codeBlocks.push({
                        node: path.node,
                        hash,
                        location: path.node.loc?.start.line || 0,
                        normalizedCode: normalized,
                    });
                },
                ClassMethod(path) {
                    const hash = self.computeASTHash(path.node);
                    const normalized = self.normalizeCode(path.node);
                    codeBlocks.push({
                        node: path.node,
                        hash,
                        location: path.node.loc?.start.line || 0,
                        normalizedCode: normalized,
                    });
                },
            });
            for (let i = 0; i < codeBlocks.length; i++) {
                for (let j = i + 1; j < codeBlocks.length; j++) {
                    const block1 = codeBlocks[i];
                    const block2 = codeBlocks[j];
                    if (block1.hash === block2.hash) {
                        duplicates.push({
                            location: block1.location,
                            duplicateLocation: block2.location,
                            similarity: 1.0,
                        });
                        continue;
                    }
                    const similarity = this.calculateCodeSimilarity(block1.normalizedCode, block2.normalizedCode);
                    if (similarity >= 0.85) {
                        duplicates.push({
                            location: block1.location,
                            duplicateLocation: block2.location,
                            similarity,
                        });
                    }
                }
            }
        }
        catch (error) {
            logger.debug('Duplicate code detection failed', error);
        }
        return duplicates;
    }
    computeASTHash(node) {
        const normalized = JSON.stringify(node, (key, value) => {
            if (['loc', 'start', 'end', 'range'].includes(key)) {
                return undefined;
            }
            if (key === 'comments' || key === 'leadingComments' || key === 'trailingComments') {
                return undefined;
            }
            return value;
        });
        let hash = 0;
        for (let i = 0; i < normalized.length; i++) {
            const char = normalized.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }
    normalizeCode(node) {
        let identifierCounter = 0;
        const identifierMap = new Map();
        const clonedNode = t.cloneNode(node, true, false);
        traverse(t.file(t.program([clonedNode])), {
            Identifier(path) {
                const name = path.node.name;
                const reserved = ['console', 'window', 'document', 'Math', 'JSON', 'Array', 'Object', 'String', 'Number'];
                if (reserved.includes(name))
                    return;
                if (!identifierMap.has(name)) {
                    identifierMap.set(name, `VAR_${identifierCounter++}`);
                }
                path.node.name = identifierMap.get(name);
            },
            StringLiteral(path) {
                path.node.value = 'STRING';
            },
            NumericLiteral(path) {
                path.node.value = 0;
            },
        });
        return JSON.stringify(clonedNode);
    }
    calculateCodeSimilarity(code1, code2) {
        const len1 = code1.length;
        const len2 = code2.length;
        if (Math.abs(len1 - len2) > Math.max(len1, len2) * 0.3) {
            return 0;
        }
        const matrix = Array.from({ length: len1 + 1 }, () => Array.from({ length: len2 + 1 }, () => 0));
        for (let i = 0; i <= len1; i++) {
            matrix[i][0] = i;
        }
        for (let j = 0; j <= len2; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                const cost = code1[i - 1] === code2[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
            }
        }
        const distance = matrix[len1][len2];
        const maxLen = Math.max(len1, len2);
        return 1 - (distance / maxLen);
    }
}
//# sourceMappingURL=CodeAnalyzer.js.map
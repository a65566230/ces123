// @ts-nocheck

import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { logger } from '../../utils/logger.js';
import { BrowserEnvironmentRulesManager } from './BrowserEnvironmentRules.js';
import { BrowserAPIDatabase } from './BrowserAPIDatabase.js';
import { AIEnvironmentAnalyzer } from './AIEnvironmentAnalyzer.js';
export class EnvironmentEmulatorEnhanced {
    llm;
    browser;
    rulesManager;
    apiDatabase;
    aiAnalyzer;
    constructor(llm) {
        this.llm = llm;
        this.rulesManager = new BrowserEnvironmentRulesManager();
        this.apiDatabase = new BrowserAPIDatabase();
        this.aiAnalyzer = new AIEnvironmentAnalyzer(llm);
    }
    async analyze(options) {
        const startTime = Date.now();
        logger.info('🌐 开始增强环境补全分析...');
        const { code, targetRuntime = 'both', autoFetch = false, browserUrl, browserType = 'chrome', includeComments = true, extractDepth = 3, useAI = true, } = options;
        try {
            logger.info('🔍 正在检测环境变量访问...');
            const detectedVariables = this.detectEnvironmentVariables(code);
            let variableManifest = {};
            if (autoFetch && browserUrl) {
                logger.info('🌐 正在从浏览器提取真实环境变量...');
                variableManifest = await this.fetchRealEnvironment(browserUrl, detectedVariables, extractDepth);
            }
            else {
                logger.info('📋 使用规则引擎生成环境变量...');
                variableManifest = this.buildManifestFromRules(detectedVariables, browserType);
            }
            const missingAPIs = this.identifyMissingAPIs(detectedVariables, variableManifest);
            let aiAnalysis = null;
            if (useAI && this.llm) {
                logger.info('🤖 正在进行AI分析...');
                aiAnalysis = await this.aiAnalyzer.analyze(code, detectedVariables, missingAPIs, browserType);
                Object.assign(variableManifest, aiAnalysis.recommendedVariables);
            }
            logger.info('📝 正在生成补环境代码...');
            const emulationCode = this.generateEmulationCode(variableManifest, missingAPIs, targetRuntime, includeComments, browserType, aiAnalysis);
            const recommendations = await this.generateRecommendations(detectedVariables, missingAPIs, aiAnalysis);
            const totalVariables = Object.values(detectedVariables).reduce((sum, arr) => sum + arr.length, 0);
            const autoFilledVariables = Object.keys(variableManifest).length;
            const manualRequiredVariables = missingAPIs.length;
            const result = {
                detectedVariables,
                emulationCode,
                missingAPIs,
                variableManifest,
                recommendations,
                stats: {
                    totalVariables,
                    autoFilledVariables,
                    manualRequiredVariables,
                },
                ...(aiAnalysis && { aiAnalysis }),
            };
            const processingTime = Date.now() - startTime;
            logger.info(`✅ 环境补全分析完成，耗时 ${processingTime}ms`);
            logger.info(`📊 检测到 ${totalVariables} 个环境变量，自动补全 ${autoFilledVariables} 个`);
            if (aiAnalysis) {
                logger.info(`🤖 AI分析置信度: ${(aiAnalysis.confidence * 100).toFixed(1)}%`);
                logger.info(`🛡️ 检测到 ${aiAnalysis.antiCrawlFeatures.length} 个反爬虫特征`);
            }
            return result;
        }
        catch (error) {
            logger.error('环境补全分析失败', error);
            throw error;
        }
    }
    detectEnvironmentVariables(code) {
        const detected = {
            window: [],
            document: [],
            navigator: [],
            location: [],
            screen: [],
            other: [],
        };
        const accessedPaths = new Set();
        try {
            const ast = parser.parse(code, {
                sourceType: 'unambiguous',
                plugins: ['jsx', 'typescript'],
            });
            const self = this;
            traverse(ast, {
                MemberExpression(path) {
                    const fullPath = self.getMemberExpressionPath(path.node);
                    if (fullPath) {
                        accessedPaths.add(fullPath);
                    }
                },
                Identifier(path) {
                    const name = path.node.name;
                    const globalObjects = [
                        'window', 'document', 'navigator', 'location', 'screen',
                        'console', 'localStorage', 'sessionStorage', 'performance',
                        'crypto', 'indexedDB', 'XMLHttpRequest', 'fetch'
                    ];
                    if (globalObjects.includes(name)) {
                        if (path.scope.hasBinding(name)) {
                            return;
                        }
                        accessedPaths.add(name);
                    }
                },
            });
            for (const path of accessedPaths) {
                if (path.startsWith('window.')) {
                    detected.window.push(path);
                }
                else if (path.startsWith('document.')) {
                    detected.document.push(path);
                }
                else if (path.startsWith('navigator.')) {
                    detected.navigator.push(path);
                }
                else if (path.startsWith('location.')) {
                    detected.location.push(path);
                }
                else if (path.startsWith('screen.')) {
                    detected.screen.push(path);
                }
                else {
                    detected.other.push(path);
                }
            }
            for (const key of Object.keys(detected)) {
                detected[key] = Array.from(new Set(detected[key])).sort();
            }
        }
        catch (error) {
            logger.warn('AST解析失败，使用正则表达式回退', error);
            this.detectWithRegex(code, detected);
        }
        return detected;
    }
    getMemberExpressionPath(node) {
        const parts = [];
        let current = node;
        while (current) {
            if (current.type === 'MemberExpression') {
                if (current.property.type === 'Identifier') {
                    parts.unshift(current.property.name);
                }
                else if (current.property.type === 'StringLiteral') {
                    parts.unshift(current.property.value);
                }
                current = current.object;
            }
            else if (current.type === 'Identifier') {
                parts.unshift(current.name);
                break;
            }
            else {
                break;
            }
        }
        const globalObjects = ['window', 'document', 'navigator', 'location', 'screen', 'performance', 'console'];
        if (parts.length > 0 && parts[0] && globalObjects.includes(parts[0])) {
            return parts.join('.');
        }
        return null;
    }
    detectWithRegex(code, detected) {
        const patterns = [
            { regex: /window\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'window' },
            { regex: /document\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'document' },
            { regex: /navigator\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'navigator' },
            { regex: /location\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'location' },
            { regex: /screen\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'screen' },
        ];
        for (const { regex, category } of patterns) {
            const matches = code.match(regex) || [];
            detected[category].push(...matches);
        }
        for (const key of Object.keys(detected)) {
            detected[key] = Array.from(new Set(detected[key])).sort();
        }
    }
    buildManifestFromRules(detected, browserType) {
        const manifest = {};
        const allPaths = [
            ...detected.window,
            ...detected.document,
            ...detected.navigator,
            ...detected.location,
            ...detected.screen,
            ...detected.other,
        ];
        for (const path of allPaths) {
            const rule = this.rulesManager.getRule(path);
            if (rule) {
                let value = rule.defaultValue;
                if (typeof value === 'function') {
                    value = value(browserType, '120.0.0.0');
                }
                manifest[path] = value;
            }
            else {
                const api = this.apiDatabase.getAPI(path);
                if (api && api.implementation) {
                    manifest[path] = api.implementation;
                }
            }
        }
        return manifest;
    }
    async fetchRealEnvironment(_url, _detected, _depth) {
        logger.warn('fetchRealEnvironment 尚未实现，返回空对象');
        return {};
    }
    identifyMissingAPIs(detected, manifest) {
        const missing = [];
        const allPaths = [
            ...detected.window,
            ...detected.document,
            ...detected.navigator,
            ...detected.location,
            ...detected.screen,
            ...detected.other,
        ];
        for (const path of allPaths) {
            if (!(path in manifest) || manifest[path] === undefined) {
                const api = this.apiDatabase.getAPI(path);
                const type = api?.type === 'method' ? 'function' :
                    api?.type === 'constructor' ? 'object' : 'property';
                missing.push({
                    name: path.split('.').pop() || path,
                    type,
                    path,
                    suggestion: this.getSuggestionForMissingAPI(path, type, api),
                });
            }
        }
        return missing;
    }
    getSuggestionForMissingAPI(path, type, api) {
        if (api?.implementation) {
            return `使用推荐实现: ${api.implementation}`;
        }
        if (type === 'function') {
            return `补充为空函数: ${path} = function() {}`;
        }
        else if (type === 'object') {
            return `补充为空对象: ${path} = {}`;
        }
        else {
            return `补充为null或合适的值: ${path} = null`;
        }
    }
    generateEmulationCode(manifest, missingAPIs, targetRuntime, includeComments, browserType, aiAnalysis) {
        let nodejs = '';
        let python = '';
        if (targetRuntime === 'nodejs' || targetRuntime === 'both') {
            nodejs = this.generateNodeJSCodeEnhanced(manifest, missingAPIs, includeComments, browserType, aiAnalysis);
        }
        if (targetRuntime === 'python' || targetRuntime === 'both') {
            python = this.generatePythonCodeEnhanced(manifest, missingAPIs, includeComments, browserType, aiAnalysis);
        }
        return { nodejs, python };
    }
    generateNodeJSCodeEnhanced(manifest, _missingAPIs, includeComments, browserType, aiAnalysis) {
        const lines = [];
        if (includeComments) {
            lines.push('/**');
            lines.push(' * 浏览器环境补全代码 (Node.js) - AI增强版');
            lines.push(` * 生成时间: ${new Date().toISOString()}`);
            lines.push(` * 目标浏览器: ${browserType}`);
            lines.push(' * 基于真实浏览器环境 + AI智能分析');
            if (aiAnalysis) {
                lines.push(` * AI置信度: ${(aiAnalysis.confidence * 100).toFixed(1)}%`);
            }
            lines.push(' */');
            lines.push('');
        }
        lines.push('// ========== 第一部分：初始化全局对象 ==========');
        lines.push('const window = global;');
        lines.push('const document = {};');
        lines.push('const navigator = {};');
        lines.push('const location = {};');
        lines.push('const screen = {};');
        lines.push('const performance = {};');
        lines.push('');
        lines.push('// ========== 第二部分：补全window对象 ==========');
        lines.push('window.window = window;');
        lines.push('window.self = window;');
        lines.push('window.top = window;');
        lines.push('window.parent = window;');
        lines.push('window.document = document;');
        lines.push('window.navigator = navigator;');
        lines.push('window.location = location;');
        lines.push('window.screen = screen;');
        lines.push('window.performance = performance;');
        lines.push('');
        lines.push('// ========== 第三部分：补全常见方法 ==========');
        const commonMethods = this.apiDatabase.getAPIsByType('method')
            .filter(api => api.path.startsWith('window.'))
            .slice(0, 15);
        for (const api of commonMethods) {
            if (api.implementation) {
                const impl = typeof api.implementation === 'string' ? api.implementation : 'function() {}';
                lines.push(`window.${api.name} = ${impl};`);
            }
        }
        lines.push('');
        lines.push('// ========== 第四部分：补全环境变量 ==========');
        const categories = this.categorizeManifest(manifest);
        for (const [category, vars] of Object.entries(categories)) {
            if (vars.length === 0)
                continue;
            if (includeComments) {
                lines.push(`// ${category} 对象属性`);
            }
            for (const [path, value] of vars) {
                const parts = path.split('.');
                if (parts.length === 1)
                    continue;
                const objName = parts[0];
                const propPath = parts.slice(1).join('.');
                if (parts.length === 2) {
                    lines.push(`${objName}.${propPath} = ${this.formatValueForJS(value)};`);
                }
                else {
                    const parentPath = parts.slice(0, -1).join('.');
                    const lastProp = parts[parts.length - 1];
                    lines.push(`if (!${parentPath}) ${parentPath} = {};`);
                    lines.push(`${parentPath}.${lastProp} = ${this.formatValueForJS(value)};`);
                }
            }
            lines.push('');
        }
        if (aiAnalysis?.recommendedAPIs && aiAnalysis.recommendedAPIs.length > 0) {
            lines.push('// ========== 第五部分：AI推荐的API实现 ==========');
            for (const rec of aiAnalysis.recommendedAPIs) {
                if (includeComments) {
                    lines.push(`// ${rec.reason}`);
                }
                lines.push(rec.implementation);
                lines.push('');
            }
        }
        if (aiAnalysis?.antiCrawlFeatures && aiAnalysis.antiCrawlFeatures.length > 0) {
            lines.push('// ========== 第六部分：反爬虫对策 ==========');
            for (const feature of aiAnalysis.antiCrawlFeatures) {
                if (feature.severity === 'high' || feature.severity === 'critical') {
                    if (includeComments) {
                        lines.push(`// ${feature.feature} - ${feature.mitigation}`);
                    }
                }
            }
            lines.push('');
        }
        lines.push('// ========== 第七部分：导出 ==========');
        lines.push('module.exports = { window, document, navigator, location, screen, performance };');
        lines.push('');
        return lines.join('\n');
    }
    generatePythonCodeEnhanced(manifest, _missingAPIs, includeComments, browserType, aiAnalysis) {
        const lines = [];
        if (includeComments) {
            lines.push('"""');
            lines.push('浏览器环境补全代码 (Python + execjs) - AI增强版');
            lines.push(`生成时间: ${new Date().toISOString()}`);
            lines.push(`目标浏览器: ${browserType}`);
            if (aiAnalysis) {
                lines.push(`AI置信度: ${(aiAnalysis.confidence * 100).toFixed(1)}%`);
            }
            lines.push('"""');
            lines.push('');
        }
        lines.push('import execjs');
        lines.push('');
        lines.push('env_code = """');
        lines.push('// 初始化全局对象');
        lines.push('const window = global;');
        lines.push('const document = {};');
        lines.push('const navigator = {};');
        lines.push('const location = {};');
        lines.push('const screen = {};');
        lines.push('');
        const categories = this.categorizeManifest(manifest);
        for (const [category, vars] of Object.entries(categories)) {
            if (vars.length === 0)
                continue;
            lines.push(`// ${category} 对象属性`);
            for (const [path, value] of vars) {
                const parts = path.split('.');
                if (parts.length >= 2) {
                    const objName = parts[0];
                    const propPath = parts.slice(1).join('.');
                    lines.push(`${objName}.${propPath} = ${this.formatValueForJS(value)};`);
                }
            }
            lines.push('');
        }
        lines.push('"""');
        lines.push('');
        lines.push('# 使用示例');
        lines.push('ctx = execjs.compile(env_code)');
        lines.push('');
        return lines.join('\n');
    }
    categorizeManifest(manifest) {
        const categories = {
            window: [],
            document: [],
            navigator: [],
            location: [],
            screen: [],
            performance: [],
            other: [],
        };
        for (const [path, value] of Object.entries(manifest)) {
            if (path.startsWith('window.')) {
                categories.window.push([path, value]);
            }
            else if (path.startsWith('document.')) {
                categories.document.push([path, value]);
            }
            else if (path.startsWith('navigator.')) {
                categories.navigator.push([path, value]);
            }
            else if (path.startsWith('location.')) {
                categories.location.push([path, value]);
            }
            else if (path.startsWith('screen.')) {
                categories.screen.push([path, value]);
            }
            else if (path.startsWith('performance.')) {
                categories.performance.push([path, value]);
            }
            else {
                categories.other.push([path, value]);
            }
        }
        return categories;
    }
    formatValueForJS(value, depth = 0) {
        if (depth > 5)
            return 'null';
        if (value === null)
            return 'null';
        if (value === undefined)
            return 'undefined';
        if (typeof value === 'string') {
            return JSON.stringify(value);
        }
        if (typeof value === 'number') {
            return isNaN(value) ? 'NaN' : isFinite(value) ? String(value) : 'null';
        }
        if (typeof value === 'boolean') {
            return String(value);
        }
        if (typeof value === 'function') {
            return 'function() {}';
        }
        if (Array.isArray(value)) {
            const items = value.slice(0, 50).map(item => this.formatValueForJS(item, depth + 1));
            return `[${items.join(', ')}]`;
        }
        if (typeof value === 'object') {
            const entries = Object.entries(value).slice(0, 100);
            const props = entries.map(([k, v]) => {
                const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
                return `${key}: ${this.formatValueForJS(v, depth + 1)}`;
            });
            return `{${props.join(', ')}}`;
        }
        return 'null';
    }
    async generateRecommendations(detected, missingAPIs, aiAnalysis) {
        if (aiAnalysis?.suggestions && aiAnalysis.suggestions.length > 0) {
            return aiAnalysis.suggestions;
        }
        return await this.aiAnalyzer.generateSuggestions(detected, missingAPIs, 'chrome');
    }
    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            this.browser = undefined;
        }
    }
}
//# sourceMappingURL=EnvironmentEmulatorEnhanced.js.map

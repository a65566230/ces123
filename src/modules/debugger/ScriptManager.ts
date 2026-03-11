// @ts-nocheck

import { logger } from '../../utils/logger.js';
export class ScriptManager {
    collector;
    cdpSession = null;
    scripts = new Map();
    scriptsByUrl = new Map();
    initialized = false;
    keywordIndex = new Map();
    scriptChunks = new Map();
    CHUNK_SIZE = 100 * 1024;
    constructor(collector) {
        this.collector = collector;
    }
    async init() {
        if (this.initialized) {
            return;
        }
        const page = await this.collector.getActivePage();
        this.cdpSession = await page.createCDPSession();
        await this.cdpSession.send('Debugger.enable');
        this.cdpSession.on('Debugger.scriptParsed', (params) => {
            const scriptInfo = {
                scriptId: params.scriptId,
                url: params.url,
                startLine: params.startLine,
                startColumn: params.startColumn,
                endLine: params.endLine,
                endColumn: params.endColumn,
                sourceLength: params.length,
            };
            this.scripts.set(params.scriptId, scriptInfo);
            if (params.url) {
                if (!this.scriptsByUrl.has(params.url)) {
                    this.scriptsByUrl.set(params.url, []);
                }
                this.scriptsByUrl.get(params.url).push(scriptInfo);
            }
            logger.debug(`Script parsed: ${params.url || 'inline'} (${params.scriptId})`);
        });
        this.initialized = true;
        logger.info('ScriptManager initialized');
    }
    async enable() {
        return this.init();
    }
    async getAllScripts(includeSource = false, maxScripts = 1000) {
        if (!this.cdpSession) {
            await this.init();
        }
        const scripts = Array.from(this.scripts.values());
        if (scripts.length > maxScripts) {
            logger.warn(`Found ${scripts.length} scripts, limiting to ${maxScripts}. Increase maxScripts parameter if needed.`);
        }
        const limitedScripts = scripts.slice(0, maxScripts);
        if (includeSource) {
            logger.warn(`Loading source code for ${limitedScripts.length} scripts. This may use significant memory.`);
            let loadedCount = 0;
            let failedCount = 0;
            for (const script of limitedScripts) {
                if (!script.source) {
                    try {
                        const { scriptSource } = await this.cdpSession.send('Debugger.getScriptSource', {
                            scriptId: script.scriptId,
                        });
                        script.source = scriptSource;
                        loadedCount++;
                        if (loadedCount % 10 === 0) {
                            logger.debug(`Loaded ${loadedCount}/${limitedScripts.length} scripts...`);
                        }
                    }
                    catch (error) {
                        logger.warn(`Failed to get source for script ${script.scriptId}:`, error);
                        failedCount++;
                    }
                }
            }
            logger.info(`getAllScripts: ${limitedScripts.length} scripts (loaded: ${loadedCount}, failed: ${failedCount})`);
        }
        else {
            logger.info(`getAllScripts: ${limitedScripts.length} scripts (source not included)`);
        }
        return limitedScripts;
    }
    async getScriptSource(scriptId, url) {
        if (!scriptId && !url) {
            throw new Error('Either scriptId or url parameter must be provided');
        }
        if (!this.cdpSession) {
            await this.init();
        }
        let targetScript;
        if (scriptId) {
            targetScript = this.scripts.get(scriptId);
        }
        else if (url) {
            const urlPattern = url.replace(/\*/g, '.*');
            const regex = new RegExp(urlPattern);
            for (const [scriptUrl, scripts] of this.scriptsByUrl.entries()) {
                if (regex.test(scriptUrl)) {
                    targetScript = scripts[0];
                    break;
                }
            }
        }
        if (!targetScript) {
            logger.warn(`Script not found: ${scriptId || url}`);
            return null;
        }
        if (!targetScript.source) {
            try {
                const { scriptSource } = await this.cdpSession.send('Debugger.getScriptSource', {
                    scriptId: targetScript.scriptId,
                });
                targetScript.source = scriptSource;
                targetScript.sourceLength = scriptSource.length;
                this.buildKeywordIndex(targetScript.scriptId, targetScript.url, scriptSource);
                this.chunkScript(targetScript.scriptId, scriptSource);
            }
            catch (error) {
                logger.error(`Failed to get script source for ${targetScript.scriptId}:`, error);
                return null;
            }
        }
        logger.info(`getScriptSource: ${targetScript.url || 'inline'} (${targetScript.sourceLength} bytes)`);
        return targetScript;
    }
    async findScriptsByUrl(urlPattern) {
        if (!this.cdpSession) {
            await this.init();
        }
        const pattern = urlPattern.replace(/\*/g, '.*');
        const regex = new RegExp(pattern);
        const results = [];
        for (const [url, scripts] of this.scriptsByUrl.entries()) {
            if (regex.test(url)) {
                results.push(...scripts);
            }
        }
        logger.info(`findScriptsByUrl: ${urlPattern} - found ${results.length} scripts`);
        return results;
    }
    clearCache() {
        this.clear();
    }
    async searchInScripts(keyword, options = {}) {
        if (!this.cdpSession) {
            await this.init();
        }
        const { isRegex = false, caseSensitive = false, contextLines = 3, maxMatches = 100, } = options;
        const searchRegex = isRegex
            ? new RegExp(keyword, caseSensitive ? 'g' : 'gi')
            : new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
        const matches = [];
        const scripts = await this.getAllScripts(true);
        for (const script of scripts) {
            if (!script.source)
                continue;
            if (matches.length >= maxMatches)
                break;
            const lines = script.source.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line)
                    continue;
                const lineMatches = Array.from(line.matchAll(searchRegex));
                for (const match of lineMatches) {
                    if (matches.length >= maxMatches)
                        break;
                    const startLine = Math.max(0, i - contextLines);
                    const endLine = Math.min(lines.length - 1, i + contextLines);
                    const contextArray = lines.slice(startLine, endLine + 1);
                    const context = contextArray.join('\n');
                    matches.push({
                        scriptId: script.scriptId,
                        url: script.url || 'inline',
                        line: i + 1,
                        column: match.index || 0,
                        matchText: match[0],
                        context,
                    });
                }
            }
        }
        logger.info(`searchInScripts: "${keyword}" - found ${matches.length} matches`);
        return {
            keyword,
            totalMatches: matches.length,
            matches,
        };
    }
    async extractFunctionTree(scriptId, functionName, options = {}) {
        const { maxDepth = 3, maxSize = 500, includeComments = true } = options;
        const script = await this.getScriptSource(scriptId);
        if (!script || !script.source) {
            throw new Error(`Script not found: ${scriptId}`);
        }
        let parser, traverse, generate, t;
        try {
            parser = await import('@babel/parser');
            traverse = (await import('@babel/traverse')).default;
            generate = (await import('@babel/generator')).default;
            t = await import('@babel/types');
        }
        catch (error) {
            throw new Error(`Failed to load Babel dependencies. Please install: npm install @babel/parser @babel/traverse @babel/generator @babel/types\nError: ${error.message}`);
        }
        let ast;
        try {
            ast = parser.parse(script.source, {
                sourceType: 'unambiguous',
                plugins: ['jsx', 'typescript'],
            });
        }
        catch (error) {
            throw new Error(`Failed to parse script ${scriptId}: ${error.message}`);
        }
        const allFunctions = new Map();
        const callGraph = {};
        const extractDependencies = (path) => {
            const deps = new Set();
            path.traverse({
                CallExpression(callPath) {
                    if (t.isIdentifier(callPath.node.callee)) {
                        deps.add(callPath.node.callee.name);
                    }
                },
            });
            return Array.from(deps);
        };
        traverse(ast, {
            FunctionDeclaration(path) {
                const name = path.node.id?.name;
                if (!name)
                    return;
                const funcCode = generate(path.node, { comments: includeComments }).code;
                const deps = extractDependencies(path);
                allFunctions.set(name, {
                    name,
                    code: funcCode,
                    startLine: path.node.loc?.start.line || 0,
                    endLine: path.node.loc?.end.line || 0,
                    dependencies: deps,
                    size: funcCode.length,
                });
                callGraph[name] = deps;
            },
            VariableDeclarator(path) {
                if (t.isIdentifier(path.node.id) &&
                    (t.isFunctionExpression(path.node.init) || t.isArrowFunctionExpression(path.node.init))) {
                    const name = path.node.id.name;
                    const funcCode = generate(path.node, { comments: includeComments }).code;
                    const deps = extractDependencies(path);
                    allFunctions.set(name, {
                        name,
                        code: funcCode,
                        startLine: path.node.loc?.start.line || 0,
                        endLine: path.node.loc?.end.line || 0,
                        dependencies: deps,
                        size: funcCode.length,
                    });
                    callGraph[name] = deps;
                }
            },
            ObjectMethod(path) {
                const key = path.node.key;
                const name = t.isIdentifier(key)
                    ? key.name
                    : t.isStringLiteral(key)
                        ? key.value
                        : undefined;
                if (!name)
                    return;
                const funcCode = generate(path.node, { comments: includeComments }).code;
                const deps = extractDependencies(path);
                allFunctions.set(name, {
                    name,
                    code: funcCode,
                    startLine: path.node.loc?.start.line || 0,
                    endLine: path.node.loc?.end.line || 0,
                    dependencies: deps,
                    size: funcCode.length,
                });
                callGraph[name] = deps;
            },
            ObjectProperty(path) {
                const key = path.node.key;
                const name = t.isIdentifier(key)
                    ? key.name
                    : t.isStringLiteral(key)
                        ? key.value
                        : undefined;
                if (!name)
                    return;
                if (!(t.isFunctionExpression(path.node.value) || t.isArrowFunctionExpression(path.node.value))) {
                    return;
                }
                const funcCode = generate(path.node.value, { comments: includeComments }).code;
                const deps = extractDependencies(path);
                allFunctions.set(name, {
                    name,
                    code: funcCode,
                    startLine: path.node.loc?.start.line || 0,
                    endLine: path.node.loc?.end.line || 0,
                    dependencies: deps,
                    size: funcCode.length,
                });
                callGraph[name] = deps;
            },
        });
        const extracted = new Set();
        const toExtract = [functionName];
        let currentDepth = 0;
        while (toExtract.length > 0 && currentDepth < maxDepth) {
            const current = toExtract.shift();
            if (extracted.has(current))
                continue;
            const func = allFunctions.get(current);
            if (!func)
                continue;
            extracted.add(current);
            for (const dep of func.dependencies) {
                if (!extracted.has(dep) && allFunctions.has(dep)) {
                    toExtract.push(dep);
                }
            }
            currentDepth++;
        }
        const functions = Array.from(extracted)
            .map(name => allFunctions.get(name))
            .filter(Boolean);
        const code = functions.map(f => f.code).join('\n\n');
        const totalSize = code.length;
        if (totalSize > maxSize * 1024) {
            logger.warn(`Extracted code size (${(totalSize / 1024).toFixed(2)}KB) exceeds limit (${maxSize}KB)`);
        }
        logger.info(`extractFunctionTree: ${functionName} - extracted ${functions.length} functions (${(totalSize / 1024).toFixed(2)}KB)`);
        return {
            mainFunction: functionName,
            code,
            functions,
            callGraph,
            totalSize,
            extractedCount: functions.length,
        };
    }
    clear() {
        this.scripts.clear();
        this.scriptsByUrl.clear();
        this.keywordIndex.clear();
        this.scriptChunks.clear();
        logger.info('✅ ScriptManager cleared - ready for new website');
    }
    async close() {
        this.clear();
        if (this.cdpSession) {
            try {
                await this.cdpSession.send('Debugger.disable');
                await this.cdpSession.detach();
                logger.info('CDP session closed');
            }
            catch (error) {
                logger.warn('Failed to close CDP session:', error);
            }
            this.cdpSession = null;
        }
        this.initialized = false;
        logger.info('✅ ScriptManager closed');
    }
    getStats() {
        let totalChunks = 0;
        for (const chunks of this.scriptChunks.values()) {
            totalChunks += chunks.length;
        }
        return {
            totalScripts: this.scripts.size,
            totalUrls: this.scriptsByUrl.size,
            indexedKeywords: this.keywordIndex.size,
            totalChunks,
        };
    }
    buildKeywordIndex(scriptId, url, content) {
        const lines = content.split('\n');
        const keywordRegex = /\b[a-zA-Z_$][a-zA-Z0-9_$]{2,}\b/g;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line)
                continue;
            const matches = Array.from(line.matchAll(keywordRegex));
            for (const match of matches) {
                const keyword = match[0].toLowerCase();
                const startLine = Math.max(0, i - 3);
                const endLine = Math.min(lines.length - 1, i + 3);
                const context = lines.slice(startLine, endLine + 1).join('\n');
                const entry = {
                    scriptId,
                    url,
                    line: i + 1,
                    column: match.index || 0,
                    context,
                };
                if (!this.keywordIndex.has(keyword)) {
                    this.keywordIndex.set(keyword, []);
                }
                this.keywordIndex.get(keyword).push(entry);
            }
        }
        logger.debug(`📇 Indexed ${this.keywordIndex.size} keywords for ${url}`);
    }
    chunkScript(scriptId, content) {
        const chunks = [];
        let offset = 0;
        let chunkIndex = 0;
        while (offset < content.length) {
            const chunk = content.substring(offset, offset + this.CHUNK_SIZE);
            chunks.push({
                scriptId,
                chunkIndex,
                content: chunk,
                size: chunk.length,
            });
            offset += this.CHUNK_SIZE;
            chunkIndex++;
        }
        this.scriptChunks.set(scriptId, chunks);
        logger.debug(`📦 Chunked script ${scriptId} into ${chunks.length} chunks`);
    }
    getScriptChunk(scriptId, chunkIndex) {
        const chunks = this.scriptChunks.get(scriptId);
        if (!chunks || chunkIndex >= chunks.length) {
            return null;
        }
        const chunk = chunks[chunkIndex];
        return chunk ? chunk.content : null;
    }
    async searchInScriptsEnhanced(keyword, options = {}) {
        const { isRegex = false, caseSensitive = false, maxMatches = 100 } = options;
        const searchTerm = caseSensitive ? keyword : keyword.toLowerCase();
        const matches = [];
        if (!isRegex) {
            for (const [indexedKeyword, entries] of this.keywordIndex.entries()) {
                if (indexedKeyword.includes(searchTerm)) {
                    for (const entry of entries) {
                        matches.push({
                            scriptId: entry.scriptId,
                            url: entry.url,
                            line: entry.line,
                            column: entry.column,
                            matchText: indexedKeyword,
                            context: entry.context,
                        });
                        if (matches.length >= maxMatches) {
                            break;
                        }
                    }
                }
                if (matches.length >= maxMatches) {
                    break;
                }
            }
            logger.info(`🔍 Enhanced search (indexed) found ${matches.length} matches for "${keyword}"`);
            return {
                keyword,
                totalMatches: matches.length,
                matches,
                searchMethod: 'indexed',
            };
        }
        else {
            const result = await this.searchInScripts(keyword, options);
            return {
                ...result,
                searchMethod: 'regex',
            };
        }
    }
}
//# sourceMappingURL=ScriptManager.js.map

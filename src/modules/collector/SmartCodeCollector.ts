// @ts-nocheck

import { logger } from '../../utils/logger.js';
export class SmartCodeCollector {
    DEFAULT_MAX_TOTAL_SIZE = 512 * 1024;
    DEFAULT_MAX_FILE_SIZE = 100 * 1024;
    PREVIEW_LINES = 50;
    async smartCollect(_page, files, options) {
        logger.info(`Smart code collection mode: ${options.mode}`);
        switch (options.mode) {
            case 'summary':
                return this.collectSummaries(files);
            case 'priority':
                return this.collectByPriority(files, options);
            case 'incremental':
                return this.collectIncremental(files, options);
            case 'full':
            default:
                return this.collectWithLimit(files, options);
        }
    }
    async collectSummaries(files) {
        logger.info('Generating code summaries...');
        return files.map(file => {
            const lines = file.content.split('\n');
            const preview = lines.slice(0, this.PREVIEW_LINES).join('\n');
            return {
                url: file.url,
                size: file.size,
                type: file.type,
                hasEncryption: this.detectEncryption(file.content),
                hasAPI: this.detectAPI(file.content),
                hasObfuscation: this.detectObfuscation(file.content),
                functions: this.extractFunctions(file.content),
                imports: this.extractImports(file.content),
                preview,
            };
        });
    }
    collectByPriority(files, options) {
        const maxTotalSize = options.maxTotalSize || this.DEFAULT_MAX_TOTAL_SIZE;
        const maxFileSize = options.maxFileSize || this.DEFAULT_MAX_FILE_SIZE;
        const scoredFiles = files.map(file => ({
            file,
            score: this.calculatePriority(file, options.priorities || []),
        }));
        scoredFiles.sort((a, b) => b.score - a.score);
        const result = [];
        let currentSize = 0;
        for (const { file } of scoredFiles) {
            let content = file.content;
            let truncated = false;
            if (file.size > maxFileSize) {
                content = content.substring(0, maxFileSize);
                truncated = true;
            }
            if (currentSize + content.length > maxTotalSize) {
                logger.warn(`Reached max total size limit (${maxTotalSize} bytes), stopping collection`);
                break;
            }
            result.push({
                ...file,
                content,
                size: content.length,
                metadata: {
                    ...file.metadata,
                    truncated,
                    originalSize: file.size,
                    priorityScore: this.calculatePriority(file, options.priorities || []),
                },
            });
            currentSize += content.length;
        }
        logger.info(`Collected ${result.length}/${files.length} files by priority (${(currentSize / 1024).toFixed(2)} KB)`);
        return result;
    }
    collectIncremental(files, options) {
        const includePatterns = options.includePatterns || [];
        const excludePatterns = options.excludePatterns || [];
        const filtered = files.filter(file => {
            if (excludePatterns.some(pattern => new RegExp(pattern).test(file.url))) {
                return false;
            }
            if (includePatterns.length === 0) {
                return true;
            }
            return includePatterns.some(pattern => new RegExp(pattern).test(file.url));
        });
        logger.info(`Incremental collection: ${filtered.length}/${files.length} files matched`);
        return this.collectWithLimit(filtered, options);
    }
    collectWithLimit(files, options) {
        const maxTotalSize = options.maxTotalSize || this.DEFAULT_MAX_TOTAL_SIZE;
        const maxFileSize = options.maxFileSize || this.DEFAULT_MAX_FILE_SIZE;
        const result = [];
        let currentSize = 0;
        for (const file of files) {
            let content = file.content;
            let truncated = false;
            if (file.size > maxFileSize) {
                content = content.substring(0, maxFileSize);
                truncated = true;
            }
            if (currentSize + content.length > maxTotalSize) {
                logger.warn(`Reached max total size limit, collected ${result.length}/${files.length} files`);
                break;
            }
            result.push({
                ...file,
                content,
                size: content.length,
                metadata: {
                    ...file.metadata,
                    truncated,
                    originalSize: file.size,
                },
            });
            currentSize += content.length;
        }
        return result;
    }
    calculatePriority(file, priorities) {
        let score = 0;
        if (file.type === 'inline')
            score += 10;
        if (file.type === 'external')
            score += 5;
        for (let i = 0; i < priorities.length; i++) {
            const pattern = priorities[i];
            if (pattern && new RegExp(pattern).test(file.url)) {
                score += (priorities.length - i) * 20;
            }
        }
        if (this.detectEncryption(file.content))
            score += 50;
        if (this.detectAPI(file.content))
            score += 30;
        if (this.detectObfuscation(file.content))
            score += 20;
        if (file.size < 10 * 1024)
            score += 10;
        else if (file.size > 500 * 1024)
            score -= 20;
        return score;
    }
    detectEncryption(content) {
        const patterns = [
            /crypto|encrypt|decrypt|cipher|aes|rsa|md5|sha/i,
            /CryptoJS|forge|sjcl/i,
            /btoa|atob/i,
        ];
        return patterns.some(pattern => pattern.test(content));
    }
    detectAPI(content) {
        const patterns = [
            /fetch\s*\(/,
            /XMLHttpRequest/,
            /axios|request|ajax/i,
            /\.get\(|\.post\(/,
        ];
        return patterns.some(pattern => pattern.test(content));
    }
    detectObfuscation(content) {
        const lines = content.split('\n');
        const avgLineLength = content.length / lines.length;
        if (avgLineLength > 200)
            return true;
        if (/\\x[0-9a-f]{2}/i.test(content))
            return true;
        if (/\\u[0-9a-f]{4}/i.test(content))
            return true;
        if (/eval\s*\(/i.test(content))
            return true;
        return false;
    }
    extractFunctions(content) {
        const functions = [];
        const patterns = [
            /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
            /const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*function/g,
            /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*function/g,
        ];
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                if (match[1] && !functions.includes(match[1])) {
                    functions.push(match[1]);
                }
            }
        }
        return functions.slice(0, 20);
    }
    extractImports(content) {
        const imports = [];
        const patterns = [
            /import\s+.*?from\s+['"]([^'"]+)['"]/g,
            /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        ];
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                if (match[1] && !imports.includes(match[1])) {
                    imports.push(match[1]);
                }
            }
        }
        return imports;
    }
}
//# sourceMappingURL=SmartCodeCollector.js.map
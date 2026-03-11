// @ts-nocheck

import { logger } from '../../utils/logger.js';
import { CryptoRulesManager } from './CryptoRules.js';
import { detectByAST, mergeParameters, evaluateSecurity, analyzeStrength, } from './CryptoDetectorEnhanced.js';
export class CryptoDetector {
    llm;
    rulesManager;
    constructor(llm, customRules) {
        this.llm = llm;
        this.rulesManager = customRules || new CryptoRulesManager();
    }
    loadCustomRules(json) {
        this.rulesManager.loadFromJSON(json);
    }
    exportRules() {
        return this.rulesManager.exportToJSON();
    }
    async detect(options) {
        logger.info('Starting crypto detection...');
        const startTime = Date.now();
        try {
            const { code } = options;
            const algorithms = [];
            const libraries = [];
            const securityIssues = [];
            const keywordResults = this.detectByKeywords(code);
            algorithms.push(...keywordResults);
            logger.debug(`Found ${keywordResults.length} algorithms by keywords`);
            const libraryResults = this.detectLibraries(code);
            libraries.push(...libraryResults);
            logger.debug(`Found ${libraryResults.length} libraries`);
            const astResults = detectByAST(code, this.rulesManager);
            algorithms.push(...astResults.algorithms);
            if (astResults.parameters) {
                mergeParameters(algorithms, astResults.parameters);
            }
            logger.debug(`Found ${astResults.algorithms.length} algorithms by AST analysis`);
            const useAI = options.useAI !== false;
            if (useAI) {
                const aiResults = await this.detectByAI(code);
                algorithms.push(...aiResults);
                logger.debug(`AI detected ${aiResults.length} algorithms`);
            }
            const mergedAlgorithms = this.mergeResults(algorithms);
            const securityResults = evaluateSecurity(mergedAlgorithms, code, this.rulesManager);
            securityIssues.push(...securityResults);
            logger.debug(`Found ${securityIssues.length} security issues`);
            const strength = analyzeStrength(mergedAlgorithms, securityIssues);
            const confidence = mergedAlgorithms.length > 0
                ? mergedAlgorithms.reduce((sum, algo) => sum + algo.confidence, 0) / mergedAlgorithms.length
                : 0;
            const duration = Date.now() - startTime;
            logger.success(`Crypto detection completed in ${duration}ms, found ${mergedAlgorithms.length} algorithms`);
            return {
                algorithms: mergedAlgorithms,
                libraries,
                confidence,
                securityIssues,
                strength,
            };
        }
        catch (error) {
            logger.error('Crypto detection failed', error);
            throw error;
        }
    }
    detectByKeywords(code) {
        const algorithms = [];
        const keywordRules = this.rulesManager.getKeywordRules();
        keywordRules.forEach((rule) => {
            rule.keywords.forEach((keyword) => {
                const regex = new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, 'gi');
                const matches = code.match(regex);
                if (matches) {
                    if (rule.category === 'mode' || rule.category === 'padding') {
                        return;
                    }
                    algorithms.push({
                        name: keyword,
                        type: rule.category,
                        confidence: rule.confidence,
                        location: {
                            file: 'current',
                            line: this.findLineNumber(code, keyword),
                        },
                        usage: `Found ${matches.length} occurrence(s) of ${keyword}${rule.description ? ` (${rule.description})` : ''}`,
                    });
                }
            });
        });
        return algorithms;
    }
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    async detectByAI(code) {
        try {
            const messages = this.llm.generateCryptoDetectionPrompt(code);
            const response = await this.llm.chat(messages, { temperature: 0.2, maxTokens: 2000 });
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return [];
            }
            const result = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(result.algorithms)) {
                return [];
            }
            return result.algorithms.map((algo) => {
                const a = algo;
                return {
                    name: a.name || 'Unknown',
                    type: a.type || 'other',
                    confidence: a.confidence || 0.5,
                    location: {
                        file: 'current',
                        line: 0,
                    },
                    parameters: a.parameters,
                    usage: a.usage || '',
                };
            });
        }
        catch (error) {
            logger.warn('AI crypto detection failed', error);
            return [];
        }
    }
    detectLibraries(code) {
        const libraries = [];
        const libraryRules = this.rulesManager.getLibraryRules();
        libraryRules.forEach((rule) => {
            const found = rule.patterns.some((pattern) => code.includes(pattern));
            if (found) {
                let version;
                if (rule.versionPattern) {
                    const versionMatch = code.match(rule.versionPattern);
                    version = versionMatch?.[1];
                }
                libraries.push({
                    name: rule.name,
                    version,
                    confidence: rule.confidence,
                });
            }
        });
        return libraries;
    }
    mergeResults(algorithms) {
        const merged = new Map();
        algorithms.forEach((algo) => {
            const key = `${algo.name}-${algo.type}`;
            const existing = merged.get(key);
            if (!existing || algo.confidence > existing.confidence) {
                merged.set(key, algo);
            }
        });
        return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence);
    }
    findLineNumber(code, keyword) {
        const lines = code.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i]?.includes(keyword)) {
                return i + 1;
            }
        }
        return 0;
    }
}
//# sourceMappingURL=CryptoDetector.js.map
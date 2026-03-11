// @ts-nocheck

import crypto from 'crypto';
import { ObfuscationDetector } from '../../../modules/detector/ObfuscationDetector.js';
import { AdvancedDeobfuscator } from '../../../modules/deobfuscator/AdvancedDeobfuscator.js';
import { Deobfuscator } from '../../../modules/deobfuscator/Deobfuscator.js';

export class ObfuscationAnalysisService {
  detector;
  deobfuscator;
  advancedDeobfuscator;
  llm;

  constructor(llm, dependencies = {}) {
    this.llm = llm;
    this.detector = new ObfuscationDetector();
    this.deobfuscator = dependencies.deobfuscator || new Deobfuscator(llm);
    this.advancedDeobfuscator = dependencies.advancedDeobfuscator || new AdvancedDeobfuscator(llm);
  }

  detect(code) {
    const source = String(code || '');
    const detected = this.detector.detect(source);
    const fallbackTypes = this.deobfuscator.detectObfuscationType(source);
    if (detected.types.includes('unknown') && Array.isArray(fallbackTypes) && fallbackTypes[0] !== 'unknown') {
      detected.types = Array.from(new Set(fallbackTypes));
    }
    return {
      detected,
      summary: detected.types.join(', '),
      recommendations: detected.recommendations,
    };
  }

  async deobfuscate(code, options = {}) {
    const source = String(code || '');
    const cacheKey = crypto.createHash('sha1').update(JSON.stringify({
      source: source.slice(0, 4000),
      options,
    })).digest('hex');

    const cached = await this.llm?.getCachedAnalysisResult?.('obfuscation-deobfuscate', cacheKey);
    if (cached) {
      return {
        ...cached,
        cached: true,
      };
    }

    const detected = this.detector.detect(source);
    const pipelineStages = ['detect', 'normalize', 'static-passes'];

    const basic = await this.deobfuscator.deobfuscate({
      code: source,
      aggressive: options.aggressive === true,
      preserveLogic: true,
      renameVariables: false,
    });
    if (detected.types.includes('unknown') && Array.isArray(basic.obfuscationType) && basic.obfuscationType[0] !== 'unknown') {
      detected.types = Array.from(new Set(basic.obfuscationType));
    }

    let finalCode = basic.code;
    let advanced;

    if (options.aggressive === true || options.aggressiveVM === true) {
      pipelineStages.push('advanced-passes');
      advanced = await this.advancedDeobfuscator.deobfuscate({
        code: finalCode,
        aggressiveVM: options.aggressiveVM === true,
        useASTOptimization: true,
      });
      finalCode = advanced.code;
    }

    if (options.includeExplanation !== false) {
      pipelineStages.push('explain');
    }

    const result = {
      cached: false,
      detected,
      pipelineStages,
      deobfuscatedCode: finalCode,
      summary: basic.analysis,
      basic,
      advanced,
      recommendations: detected.recommendations,
    };

    await this.llm?.storeCachedAnalysisResult?.('obfuscation-deobfuscate', cacheKey, result);
    return result;
  }
}

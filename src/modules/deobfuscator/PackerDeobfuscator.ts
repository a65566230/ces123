// @ts-nocheck

import { logger } from '../../utils/logger.js';
export class PackerDeobfuscator {
    static detect(code) {
        const packerPattern = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/;
        return packerPattern.test(code);
    }
    async deobfuscate(options) {
        const { code, maxIterations = 5 } = options;
        logger.info('📦 开始Packer反混淆...');
        const warnings = [];
        let currentCode = code;
        let iterations = 0;
        try {
            while (PackerDeobfuscator.detect(currentCode) && iterations < maxIterations) {
                const unpacked = this.unpack(currentCode);
                if (!unpacked || unpacked === currentCode) {
                    warnings.push('解包失败或已达到最终状态');
                    break;
                }
                currentCode = unpacked;
                iterations++;
                logger.info(`📦 完成第 ${iterations} 次解包`);
            }
            logger.info(`✅ Packer反混淆完成，共 ${iterations} 次迭代`);
            return {
                code: currentCode,
                success: true,
                iterations,
                warnings,
            };
        }
        catch (error) {
            logger.error('Packer反混淆失败', error);
            return {
                code: currentCode,
                success: false,
                iterations,
                warnings: [...warnings, String(error)],
            };
        }
    }
    unpack(code) {
        const match = code.match(/eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*{([\s\S]*?)}\s*\((.*?)\)\s*\)/);
        if (!match || !match[2]) {
            return code;
        }
        const args = match[2];
        const params = this.parsePackerParams(args);
        if (!params) {
            return code;
        }
        try {
            const unpacked = this.executeUnpacker(params);
            return unpacked || code;
        }
        catch (error) {
            logger.warn('解包执行失败', error);
            return code;
        }
    }
    parsePackerParams(argsString) {
        try {
            const parseFunc = new Function(`return [${argsString}];`);
            const params = parseFunc();
            if (params.length < 4) {
                return null;
            }
            return {
                p: params[0] || '',
                a: params[1] || 0,
                c: params[2] || 0,
                k: (params[3] || '').split('|'),
                e: params[4] || function (c) { return c; },
                d: params[5] || function () { return ''; },
            };
        }
        catch {
            return null;
        }
    }
    executeUnpacker(params) {
        const { p, a, k } = params;
        let { c } = params;
        let result = p;
        while (c--) {
            const replacement = k[c];
            if (replacement) {
                const pattern = new RegExp('\\b' + this.base(c, a) + '\\b', 'g');
                result = result.replace(pattern, replacement);
            }
        }
        return result;
    }
    base(num, radix) {
        const digits = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (num === 0) {
            return '0';
        }
        let result = '';
        while (num > 0) {
            result = digits[num % radix] + result;
            num = Math.floor(num / radix);
        }
        return result || '0';
    }
    beautify(code) {
        let result = code;
        result = result.replace(/;/g, ';\n');
        result = result.replace(/{/g, '{\n');
        result = result.replace(/}/g, '\n}\n');
        result = result.replace(/\n\n+/g, '\n\n');
        return result.trim();
    }
}
export class AAEncodeDeobfuscator {
    static detect(code) {
        return code.includes('゜-゜') || code.includes('ω゜') || code.includes('o゜)');
    }
    async deobfuscate(code) {
        logger.info('😊 开始AAEncode反混淆...');
        try {
            const decoded = new Function(`return (${code})`)();
            logger.info('✅ AAEncode反混淆完成');
            return decoded;
        }
        catch (error) {
            logger.error('AAEncode反混淆失败', error);
            return code;
        }
    }
}
export class URLEncodeDeobfuscator {
    static detect(code) {
        const percentCount = (code.match(/%[0-9A-Fa-f]{2}/g) || []).length;
        return percentCount > 10;
    }
    async deobfuscate(code) {
        logger.info('🔗 开始URLEncode反混淆...');
        try {
            const decoded = decodeURIComponent(code);
            logger.info('✅ URLEncode反混淆完成');
            return decoded;
        }
        catch (error) {
            logger.error('URLEncode反混淆失败', error);
            return code;
        }
    }
}
export class UniversalUnpacker {
    packerDeobfuscator = new PackerDeobfuscator();
    aaencodeDeobfuscator = new AAEncodeDeobfuscator();
    urlencodeDeobfuscator = new URLEncodeDeobfuscator();
    async deobfuscate(code) {
        logger.info('🔍 自动检测混淆类型...');
        if (PackerDeobfuscator.detect(code)) {
            logger.info('检测到: Packer混淆');
            const result = await this.packerDeobfuscator.deobfuscate({ code });
            return {
                code: result.code,
                type: 'Packer',
                success: result.success,
            };
        }
        if (AAEncodeDeobfuscator.detect(code)) {
            logger.info('检测到: AAEncode混淆');
            const decoded = await this.aaencodeDeobfuscator.deobfuscate(code);
            return {
                code: decoded,
                type: 'AAEncode',
                success: decoded !== code,
            };
        }
        if (URLEncodeDeobfuscator.detect(code)) {
            logger.info('检测到: URLEncode混淆');
            const decoded = await this.urlencodeDeobfuscator.deobfuscate(code);
            return {
                code: decoded,
                type: 'URLEncode',
                success: decoded !== code,
            };
        }
        logger.info('未检测到已知的混淆类型');
        return {
            code,
            type: 'Unknown',
            success: false,
        };
    }
}
//# sourceMappingURL=PackerDeobfuscator.js.map
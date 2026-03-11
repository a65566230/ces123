// @ts-nocheck

import crypto from 'crypto';

export class BundleFingerprintService {
  public fingerprint(code) {
    const source = String(code || '');
    const lowerCode = source.toLowerCase();
    const obfuscationSignals = [];
    const apiSignals = [];

    if (/_0x[a-f0-9]+/i.test(source)) {
      obfuscationSignals.push('hex-array-identifiers');
    }
    if (source.includes('eval(')) {
      obfuscationSignals.push('eval-usage');
    }
    if (source.includes('Function(')) {
      obfuscationSignals.push('dynamic-function-constructor');
    }

    for (const signal of ['fetch(', 'XMLHttpRequest', 'crypto.subtle', 'WebSocket', 'Authorization', 'signature', 'token']) {
      if (source.includes(signal)) {
        apiSignals.push(signal);
      }
    }

    let probableBundler = 'unknown';
    if (source.includes('__webpack_require__')) {
      probableBundler = 'webpack';
    } else if (source.includes('import.meta.hot') || source.includes('__vite_ssr_exports__')) {
      probableBundler = 'vite';
    } else if (lowerCode.includes('parcelrequire')) {
      probableBundler = 'parcel';
    } else if (source.includes('function __require')) {
      probableBundler = 'rollup';
    }

    return {
      sha256: crypto.createHash('sha256').update(source).digest('hex'),
      sizeBytes: source.length,
      lineCount: source.split(/\r?\n/).length,
      probableBundler,
      probableMinified: source.length > 1000 && !source.includes('\n'),
      obfuscationSignals,
      apiSignals,
    };
  }
}

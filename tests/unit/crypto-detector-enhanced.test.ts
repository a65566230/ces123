import { CryptoRulesManager } from '../../src/modules/crypto/CryptoRules.js';
import { detectByAST } from '../../src/modules/crypto/CryptoDetectorEnhanced.js';

describe('CryptoDetectorEnhanced AST analysis', () => {
  test('extracts crypto parameters through the Babel traverse compatibility layer', () => {
    const code = `
      crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, tagLength: 128 },
        keyMaterial,
        payload
      );
    `;

    const result = detectByAST(code, new CryptoRulesManager());

    expect(result.parameters.get('AES-GCM')).toEqual({
      name: 'AES-GCM',
      iv: 'nonce',
      tagLength: 128,
    });
  });
});

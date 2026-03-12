import { ASTOptimizer } from '../../src/modules/deobfuscator/ASTOptimizer.js';
import { Deobfuscator } from '../../src/modules/deobfuscator/Deobfuscator.js';
import { resolveBabelTraverse } from '../../src/utils/babelTraverse.js';

describe('babel traverse interop', () => {
  test('unwraps nested default exports from @babel/traverse in tsx runtime shape', () => {
    const traverseFn = () => 'ok';

    expect(resolveBabelTraverse({ default: { default: traverseFn } })).toBe(traverseFn);
  });

  test('ast optimizer still performs constant folding with the installed traverse module shape', () => {
    const optimizer = new ASTOptimizer();

    const optimized = optimizer.optimize('const total = 1 + 2;');

    expect(optimized).toContain('3');
    expect(optimized).not.toContain('1 + 2');
  });

  test('deobfuscator basic AST passes stay active instead of silently returning original code', async () => {
    const deobfuscator = new Deobfuscator(undefined);

    const result = await deobfuscator.deobfuscate({
      code: 'if (true) { const total = 1 + 2; }',
      aggressive: false,
      preserveLogic: true,
    });

    expect(result.code).toContain('3');
    expect(result.code).not.toContain('1 + 2');
    expect(result.transformations.find((item) => item.type === 'basic-ast-transform')?.success).toBe(true);
  });
});

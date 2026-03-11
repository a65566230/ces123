// @ts-nocheck

export class ScriptDiffService {
  public diff(leftCode, rightCode) {
    const leftLines = String(leftCode || '').split(/\r?\n/);
    const rightLines = String(rightCode || '').split(/\r?\n/);
    const maxLines = Math.max(leftLines.length, rightLines.length);
    const hunks = [];

    for (let index = 0; index < maxLines; index += 1) {
      const left = leftLines[index] ?? '';
      const right = rightLines[index] ?? '';
      if (left !== right) {
        hunks.push({
          line: index + 1,
          left,
          right,
        });
      }
    }

    return {
      changedLines: hunks.length,
      leftLineCount: leftLines.length,
      rightLineCount: rightLines.length,
      hunks,
    };
  }
}

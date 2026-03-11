import { paginateItems } from '../../src/server/v2/pagination.js';

describe('pagination helpers', () => {
  test('returns page metadata and next cursor', () => {
    const result = paginateItems(
      ['a', 'b', 'c', 'd', 'e'].map((value, index) => ({ id: value, index })),
      {
        cursor: '1',
        pageSize: 2,
      },
    );

    expect(result.items.length).toBe(2);
    expect(result.page.page).toBe(2);
    expect(result.page.hasMore).toBe(true);
    expect(result.page.nextCursor).toBe('3');
  });
});

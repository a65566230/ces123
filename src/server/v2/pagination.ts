export interface PaginationOptions {
  cursor?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  page: {
    page: number;
    pageSize: number;
    hasMore: boolean;
    nextCursor: string | null;
    totalItems: number;
  };
}

export function paginateItems<T>(items: T[], options: PaginationOptions = {}): PaginatedResult<T> {
  const pageSize = Math.max(1, options.pageSize ?? 20);
  const offsetFromCursor = options.cursor ? Number(options.cursor) + 1 : undefined;
  const offsetFromPage = typeof options.page === 'number' && options.page > 0 ? (options.page - 1) * pageSize : 0;
  const offset = Number.isFinite(offsetFromCursor) ? Math.max(0, offsetFromCursor as number) : offsetFromPage;

  const pagedItems = items.slice(offset, offset + pageSize);
  const nextOffset = offset + pageSize;

  return {
    items: pagedItems,
    page: {
      page: Math.floor(offset / pageSize) + 1,
      pageSize,
      hasMore: nextOffset < items.length,
      nextCursor: nextOffset < items.length ? String(nextOffset - 1) : null,
      totalItems: items.length,
    },
  };
}

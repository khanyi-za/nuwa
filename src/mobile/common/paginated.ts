/**
 * Pagination metadata shape returned to the mobile client alongside `data`.
 * Per maya `api-conventions.md` §Pagination — both cursor and offset styles are
 * supported; an endpoint populates whichever fields apply.
 */
export interface PaginationMeta {
  limit: number;
  hasMore: boolean;
  nextCursor?: string | null;
  offset?: number;
  total?: number;
}

/**
 * Marker wrapper a mobile handler returns when its response carries pagination.
 * `MobileResponseInterceptor` lifts `pagination` to the top level of the
 * envelope: `{ success, data, pagination }`. Plain (non-paginated) handler
 * returns are wrapped as `{ success, data }`.
 */
export class Paginated<T> {
  constructor(
    public readonly data: T,
    public readonly pagination: PaginationMeta,
  ) {}
}

import { ConflictException } from '@nestjs/common';
import { releaseStock, reserveStock } from './stock';

/**
 * Stock primitives are thin wrappers around `tx.$executeRaw` tagged
 * templates. We mock the tx client and assert two things:
 *   1. The raw statement targets the correct table (`products` vs
 *      `product_variants`) based on whether variantId is provided.
 *   2. Zero rows-affected from reserveStock surfaces as a 409.
 *
 * Prisma's tagged template calls `$executeRaw` with the parts array as the
 * first arg and the interpolated values as the rest; we pluck the parts
 * array and pattern-match on its joined string to verify the table choice.
 */

type ExecuteRawMock = jest.Mock & {
  mockRows: (n: number) => void;
  lastSql: () => string;
  lastValues: () => unknown[];
};

function makeTx(): { tx: { $executeRaw: ExecuteRawMock } } {
  let nextRows = 1;
  const calls: { parts: TemplateStringsArray; values: unknown[] }[] = [];

  const mock = jest.fn(
    (parts: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ parts, values });
      return Promise.resolve(nextRows);
    },
  ) as ExecuteRawMock;

  mock.mockRows = (n: number) => {
    nextRows = n;
  };
  mock.lastSql = () => {
    const last = calls[calls.length - 1];
    return last.parts.join('?');
  };
  mock.lastValues = () => calls[calls.length - 1].values;

  return { tx: { $executeRaw: mock } };
}

describe('reserveStock', () => {
  it('updates the products table when variantId is null', async () => {
    const { tx } = makeTx();
    tx.$executeRaw.mockRows(1);

    await reserveStock(tx as never, 'prod-1', null, 3);

    const sql = tx.$executeRaw.lastSql();
    expect(sql).toContain('"products"');
    expect(sql).toContain('"totalStock"');
    expect(sql).not.toContain('"product_variants"');
    expect(tx.$executeRaw.lastValues()).toEqual([3, 'prod-1', 3]);
  });

  it('updates the product_variants table when variantId is set', async () => {
    const { tx } = makeTx();
    tx.$executeRaw.mockRows(1);

    await reserveStock(tx as never, 'prod-1', 'var-1', 2);

    const sql = tx.$executeRaw.lastSql();
    expect(sql).toContain('"product_variants"');
    expect(sql).toContain('"stock"');
    expect(sql).not.toContain('"products"\n');
    expect(tx.$executeRaw.lastValues()).toEqual([2, 'var-1', 2]);
  });

  it('throws ConflictException when rows-affected is 0 (out of stock)', async () => {
    const { tx } = makeTx();
    tx.$executeRaw.mockRows(0);

    await expect(reserveStock(tx as never, 'prod-1', null, 5)).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects non-positive deltas', async () => {
    const { tx } = makeTx();

    await expect(reserveStock(tx as never, 'prod-1', null, 0)).rejects.toThrow(
      /non-positive delta/,
    );
    await expect(
      reserveStock(tx as never, 'prod-1', null, -1),
    ).rejects.toThrow(/non-positive delta/);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('releaseStock', () => {
  it('updates the products table unconditionally when variantId is null', async () => {
    const { tx } = makeTx();

    await releaseStock(tx as never, 'prod-1', null, 4);

    const sql = tx.$executeRaw.lastSql();
    expect(sql).toContain('"products"');
    expect(sql).toContain('GREATEST');
    expect(tx.$executeRaw.lastValues()).toEqual([4, 'prod-1']);
  });

  it('updates the product_variants table when variantId is set', async () => {
    const { tx } = makeTx();

    await releaseStock(tx as never, 'prod-1', 'var-1', 1);

    const sql = tx.$executeRaw.lastSql();
    expect(sql).toContain('"product_variants"');
    expect(sql).toContain('GREATEST');
    expect(tx.$executeRaw.lastValues()).toEqual([1, 'var-1']);
  });

  it('does not throw on zero rows-affected (release is unconditional)', async () => {
    const { tx } = makeTx();
    tx.$executeRaw.mockRows(0);

    await expect(
      releaseStock(tx as never, 'prod-1', null, 2),
    ).resolves.toBeUndefined();
  });

  it('rejects non-positive deltas', async () => {
    const { tx } = makeTx();

    await expect(releaseStock(tx as never, 'prod-1', null, 0)).rejects.toThrow(
      /non-positive delta/,
    );
    await expect(
      releaseStock(tx as never, 'prod-1', null, -3),
    ).rejects.toThrow(/non-positive delta/);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

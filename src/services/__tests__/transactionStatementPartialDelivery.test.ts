import { beforeEach, describe, expect, it, vi } from 'vitest';

// 분할입고: 발주 20개 → 거래명세서 10개 + 10개 두 장이 같은 발주 품목에 매칭되는 흐름
type Row = Record<string, unknown>;
let db: Record<string, Row[]>;

const getField = (row: Row, column: string): unknown => {
  if (column.startsWith('statement.')) {
    const statement = db.transaction_statements.find(s => s.id === row.statement_id);
    return statement?.[column.slice('statement.'.length)];
  }
  return row[column];
};

class FakeQuery {
  private op: 'select' | 'update' | 'insert' = 'select';
  private payload: Row = {};
  private filters: Array<(row: Row) => boolean> = [];
  private isSingle = false;

  constructor(private table: string) {}

  select() { return this; }
  update(payload: Row) { this.op = 'update'; this.payload = payload; return this; }
  insert(payload: Row) { this.op = 'insert'; this.payload = payload; return this; }
  eq(column: string, value: unknown) { this.filters.push(row => String(getField(row, column)) === String(value)); return this; }
  neq(column: string, value: unknown) { this.filters.push(row => String(getField(row, column)) !== String(value)); return this; }
  in(column: string, values: unknown[]) { this.filters.push(row => values.map(String).includes(String(getField(row, column)))); return this; }
  not(column: string) { this.filters.push(row => getField(row, column) != null); return this; }
  single() { this.isSingle = true; return this; }

  then<T>(resolve: (value: { data: unknown; error: null }) => T) {
    const rows = (db[this.table] ||= []).filter(row => this.filters.every(filter => filter(row)));
    if (this.op === 'update') rows.forEach(row => Object.assign(row, this.payload));
    if (this.op === 'insert') db[this.table].push({ ...this.payload });
    const withJoin = rows.map(row => ({
      ...row,
      statement: db.transaction_statements.find(s => s.id === row.statement_id) ?? null
    }));
    return Promise.resolve({ data: this.isSingle ? withJoin[0] ?? null : withJoin, error: null }).then(resolve);
  }
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => new FakeQuery(table)
  })
}));

const { transactionStatementService: service } = await import('../transactionStatementService');
const helpers = service as unknown as {
  getQuantityMatchedClaims: (ids: number[]) => Promise<Map<number, Array<{ statementId: string; quantity: number }>>>;
  getUnclaimedReceivedQuantity: (received: number | null | undefined, claims: Array<{ statementId: string; quantity: number }> | undefined, statementId: string) => number | null;
  getStatementShareAmount: (item: Row, statementQuantity: number) => number;
};

const PURCHASE_ITEM_ID = 19373;
const purchaseItem = () => db.purchase_request_items[0];
const statementRequest = (statementId: string, itemId: string) => ({
  statementId,
  actual_received_date: '2026-10-28',
  accounting_received_date: '2026-10-28',
  items: [{
    itemId,
    matched_purchase_id: 5614,
    matched_item_id: PURCHASE_ITEM_ID,
    confirmed_quantity: 10,
    confirmed_unit_price: 32000,
    confirmed_amount: 320000
  }]
});
const unclaimedFor = async (statementId: string) => {
  const claims = await helpers.getQuantityMatchedClaims([PURCHASE_ITEM_ID]);
  return helpers.getUnclaimedReceivedQuantity(
    purchaseItem().received_quantity as number | null, claims.get(PURCHASE_ITEM_ID), statementId
  );
};

describe('거래명세서 분할입고 (발주 20개 = 명세서 10개 + 10개)', () => {
  beforeEach(() => {
    db = {
      purchase_request_items: [{
        id: PURCHASE_ITEM_ID, purchase_request_id: 5614, quantity: 20, unit_price_value: 26000, amount_value: 520000,
        received_quantity: null, receipt_history: [], is_received: false, is_statement_received: false
      }],
      purchase_requests: [{ id: 5614, is_received: false }],
      transaction_statements: [
        { id: 's1', status: 'extracted', quantity_match_confirmed_at: null, manager_confirmed_at: null },
        { id: 's2', status: 'extracted', quantity_match_confirmed_at: null, manager_confirmed_at: null }
      ],
      transaction_statement_items: [
        { id: 'i1', statement_id: 's1', matched_item_id: PURCHASE_ITEM_ID, extracted_quantity: 10, is_confirmed: false },
        { id: 'i2', statement_id: 's2', matched_item_id: PURCHASE_ITEM_ID, extracted_quantity: 10, is_confirmed: false }
      ]
    };
  });

  it('두 장을 순서대로 처리하면 입고·금액·명세서 확인이 누적으로 맞는다', async () => {
    // 1차: 입고 전이라 수량 불일치 → 수량일치 확인으로 10개 입고
    expect(await unclaimedFor('s1')).toBeNull();
    await service.confirmQuantityMatch(statementRequest('s1', 'i1'), '테스터');
    expect(purchaseItem()).toMatchObject({ received_quantity: 10, delivery_status: 'partial', is_received: false });
    expect(await unclaimedFor('s1')).toBe(10);

    // 1차 확정: 발주 금액은 명세서 금액(32만)으로 덮지 않고 단가 × 발주수량, 명세서 확인은 아직 미완료
    await service.confirmStatement(statementRequest('s1', 'i1'), '테스터');
    expect(purchaseItem()).toMatchObject({ unit_price_value: 32000, amount_value: 640000, is_statement_received: false });
    expect(helpers.getStatementShareAmount(purchaseItem(), 10)).toBe(320000);

    // 2차: 1차 몫 10개를 빼면 남은 입고는 0 → 자동으로 일치 처리되지 않음
    expect(await unclaimedFor('s2')).toBe(0);
    await service.confirmQuantityMatch(statementRequest('s2', 'i2'), '테스터');
    expect(purchaseItem()).toMatchObject({ received_quantity: 20, delivery_status: 'received', is_received: true });
    expect(await unclaimedFor('s2')).toBe(10);

    // 2차 확정: 누적 20개로 발주 수량을 채워 명세서 확인 완료
    await service.confirmStatement(statementRequest('s2', 'i2'), '테스터');
    expect(purchaseItem()).toMatchObject({ amount_value: 640000, is_statement_received: true });
    expect((purchaseItem().receipt_history as unknown[]).length).toBe(2);
  });

  it('한 장으로 전량 납품되면 기존처럼 명세서 금액을 반영하고 바로 확인 완료', async () => {
    const request = statementRequest('s1', 'i1');
    request.items[0] = { ...request.items[0], confirmed_quantity: 20, confirmed_amount: 640000 };
    await service.confirmQuantityMatch(request, '테스터');
    await service.confirmStatement(request, '테스터');
    expect(purchaseItem()).toMatchObject({ received_quantity: 20, amount_value: 640000, is_statement_received: true });
  });
});

import { parseOrderNumberWithLine, extractOrderNumber } from '../supabase/functions/_shared/order-number.ts';

const text = "M-11 F20260422_007-22(2)";
console.log('extractOrderNumber:', extractOrderNumber(text));
console.log('parseOrderNumberWithLine F20260422_007-22(2):', parseOrderNumberWithLine("F20260422_007-22(2)"));
console.log('parseOrderNumberWithLine F20260422_007-22:', parseOrderNumberWithLine("F20260422_007-22"));

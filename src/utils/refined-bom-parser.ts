/**
 * 정리본 엑셀 직접 파서
 *
 * 담당자가 이미 정리된 BOM 정리본(보드명 시트 + TOP/BOTTOM 시트)을 업로드하면
 * 원본 가공(v7 엔진) 없이 그대로 읽어들여 미리보기/저장 흐름에 태운다.
 * scripts/migrate-legacy-boms.cjs 의 파싱 규칙과 동일 — 표 안의 항목만 사용하고
 * 표 밖 메모, "** 보드명 **" 배너 행은 무시한다.
 *
 * 지원 형식:
 *  - 신형식: 헤더 [번호|종류|품명|SET|수량|재고|CHECK|Ref|대체 가능품목|비고]
 *  - 구형식: 헤더 [번호|종류|품명|SET|수량|재고|Ref|비고] (CHECK/대체품 없음)
 *  - 좌표 시트 헤더 변형: RefDes/RefDesignator, LocationX/X, Rotation/Rot/Orient., Layer/Side 등
 */

import type { BOMItem, CoordinateItem } from './v7-generator';

export interface RefinedParseResult {
  bomItems: BOMItem[];
  topCoordinates: CoordinateItem[];
  bottomCoordinates: CoordinateItem[];
  /** "** 보드명 **" 배너 행의 수량 칼럼 값 (제작수량) */
  productionQuantity: number;
  /** 파일에서 추정한 보드명 (첫 부품리스트 시트명) */
  boardSheetName: string;
}

export class RefinedParseError extends Error {}

type Row = (string | number | null)[];

const cellStr = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

const cellInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

const cellNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Ref 범위 표기 전개: "U1~U4" → "U1, U2, U3, U4" (좌표 REF 매칭을 위해) */
export function expandRefRanges(refRaw: string): string {
  if (!refRaw || !refRaw.includes('~')) return refRaw;
  return refRaw
    .split(',')
    .map(tok => tok.trim())
    .filter(Boolean)
    .flatMap(tok => {
      const m = tok.match(/^([A-Za-z]+)(\d+)\s*~\s*([A-Za-z]*)(\d+)$/);
      if (!m) return [tok];
      const [, prefix, startStr, prefix2, endStr] = m;
      if (prefix2 && prefix2.toUpperCase() !== prefix.toUpperCase()) return [tok];
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 500) return [tok];
      return Array.from({ length: end - start + 1 }, (_, i) => `${prefix}${start + i}`);
    })
    .join(', ');
}

/** Ref 셀 토큰에 붙은 메모를 분리: "U51~U54 --> 변경사항" → refs="U51~U54", comment="변경사항" */
export function splitRefComment(refRaw: string): { refs: string; comment: string } {
  if (!refRaw) return { refs: '', comment: '' };
  const refs: string[] = [];
  const comments: string[] = [];
  for (const tok of refRaw.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = tok.match(/^([A-Za-z]+\d+(?:\s*~\s*[A-Za-z]*\d+)?)\s*(?:-->|→|=>)\s*(.+)$/);
    if (m) {
      refs.push(m[1]);
      comments.push(m[2].trim());
    } else {
      refs.push(tok);
    }
  }
  return { refs: refs.join(', '), comment: comments.join(' / ') };
}

/** 보드명(부품리스트) 시트 파싱 */
function parseBoardSheet(rows: Row[]): { items: BOMItem[]; productionQuantity: number } | null {
  let headerIdx = -1;
  const col: Partial<Record<'no' | 'type' | 'name' | 'set' | 'qty' | 'stock' | 'check' | 'ref' | 'alt' | 'remark', number>> = {};

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const texts = (rows[i] || []).map(cellStr);
    if (texts.some(t => t === '품명') && texts.some(t => /^SET$/i.test(t) || t === '수량')) {
      headerIdx = i;
      texts.forEach((t, idx) => {
        if (t === '번호') col.no = idx;
        else if (t === '종류') col.type = idx;
        else if (t === '품명') col.name = idx;
        else if (/^SET$/i.test(t)) col.set = idx;
        else if (t === '수량') col.qty = idx;
        else if (t === '재고') col.stock = idx;
        else if (/CHECK/i.test(t)) col.check = idx;
        else if (/^Ref$/i.test(t)) col.ref = idx;
        else if (/대체/.test(t)) col.alt = idx;
        else if (t === '비고') col.remark = idx;
      });
      break;
    }
  }
  if (headerIdx < 0 || col.name === undefined) return null;

  const items: BOMItem[] = [];
  let productionQuantity = 0;
  let currentType = '';
  let line = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const rawType = col.type !== undefined ? cellStr(r[col.type]) : '';
    const name = cellStr(r[col.name!]);

    // "** 보드명 **" 배너 행: 수량 칼럼 값 = 제작수량
    if (/\*\*/.test(rawType) || /\*\*/.test(name)) {
      const pq = col.qty !== undefined ? cellInt(r[col.qty]) : null;
      if (pq && !productionQuantity) productionQuantity = pq;
      continue;
    }
    if (!name) continue;
    // 표 밖 메모 배제: 번호/SET/수량 전부 비고 종류도 없는 행은 스킵
    const noVal = col.no !== undefined ? cellInt(r[col.no]) : null;
    const setVal = col.set !== undefined ? cellInt(r[col.set]) : null;
    const qtyVal = col.qty !== undefined ? cellInt(r[col.qty]) : null;
    if (noVal === null && setVal === null && qtyVal === null && !rawType) continue;

    if (rawType) currentType = rawType;
    line += 1;

    const stockRaw = col.stock !== undefined ? cellStr(r[col.stock]) : '';
    const stockNum = cellInt(stockRaw);
    let remark = col.remark !== undefined ? cellStr(r[col.remark]) : '';
    if (stockRaw && stockNum === null) {
      // '사급' 같은 텍스트 재고는 비고로 보존
      remark = remark ? `${remark} / 재고:${stockRaw}` : `재고:${stockRaw}`;
    }

    // Ref 셀 안의 메모("U51~U54 --> 2.5V에서 3.3V로 변경")는 비고로 분리하고 REF만 남긴다
    const { refs: refRaw, comment: refComment } = splitRefComment(col.ref !== undefined ? cellStr(r[col.ref]) : '');
    if (refComment) {
      remark = remark ? `${remark} / ${refComment}` : refComment;
    }

    items.push({
      lineNumber: noVal ?? line,
      itemType: currentType,
      itemName: name,
      setCount: setVal ?? 0,
      totalQuantity: qtyVal ?? 0,
      stockQuantity: stockNum ?? 0,
      checkStatus: col.check !== undefined ? cellStr(r[col.check]) : '',
      refList: expandRefRanges(refRaw),
      alternativeItem: col.alt !== undefined ? cellStr(r[col.alt]) : '',
      remark,
      isManualRequired: false,
      isNewPart: false,
    });
  }

  return items.length > 0 ? { items, productionQuantity } : null;
}

/** TOP/BOTTOM 좌표 시트 파싱 */
function parseCoordSheet(rows: Row[], side: 'TOP' | 'BOTTOM'): CoordinateItem[] {
  let headerIdx = -1;
  const col: Partial<Record<'ref' | 'name' | 'kind' | 'layer' | 'x' | 'y' | 'rot', number>> = {};

  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const texts = (rows[i] || []).map(cellStr);
    const refIdx = texts.findIndex(t => /^(refdes|refdesignator|ref des)/i.test(t));
    if (refIdx >= 0) {
      headerIdx = i;
      texts.forEach((t, idx) => {
        if (/^(refdes|refdesignator|ref des)/i.test(t)) col.ref = idx;
        else if (/^(type|partdecal|partnumber)$/i.test(t)) col.name = idx;
        else if (/^parttype$/i.test(t)) col.kind = idx;
        else if (/^(layer|side)$/i.test(t)) col.layer = idx;
        else if (/^(locationx|x)$/i.test(t)) col.x = idx;
        else if (/^(locationy|y)$/i.test(t)) col.y = idx;
        else if (/^(rotation|rot|orient\.?)$/i.test(t)) col.rot = idx;
      });
      // 종류 칼럼(헤더 없음)은 관례상 첫 칼럼 — 다른 매핑이 차지하지 않았을 때만
      if (col.kind === undefined && col.ref !== 0 && col.name !== 0 && col.x !== 0) col.kind = 0;
      break;
    }
  }
  if (headerIdx < 0 || col.ref === undefined || col.x === undefined || col.y === undefined) return [];

  const items: CoordinateItem[] = [];
  let currentKind = '';
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const ref = cellStr(r[col.ref]);
    if (!ref || /^\d+$/.test(ref)) continue; // RefDes가 숫자만이면 배제
    const x = cellNum(r[col.x]);
    const y = cellNum(r[col.y]);
    if (x === null || y === null) continue;
    if (col.kind !== undefined) {
      const kindRaw = cellStr(r[col.kind]);
      if (kindRaw) currentKind = kindRaw;
    }
    let rowSide: 'TOP' | 'BOTTOM' = side;
    if (col.layer !== undefined) {
      const lv = cellStr(r[col.layer]).toUpperCase();
      if (lv === 'TOP' || lv === 'BOTTOM') rowSide = lv as 'TOP' | 'BOTTOM';
    }
    items.push({
      refDes: ref,
      partName: col.name !== undefined ? cellStr(r[col.name]) : '',
      type: currentKind,
      layer: rowSide,
      locationX: x,
      locationY: y,
      rotation: cellNum(col.rot !== undefined ? r[col.rot] : null) ?? 0,
      remark: '',
    });
  }
  return items;
}

/** 정리본 파일 파싱 진입점 */
export async function parseRefinedBomFile(file: File): Promise<RefinedParseResult> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });

  const sheetNames = wb.SheetNames;
  const topName = sheetNames.find(s => /^top$/i.test(s.trim()));
  const bottomName = sheetNames.find(s => /^bottom$/i.test(s.trim()));
  const boardSheetCandidates = sheetNames.filter(s => !/^(top|bottom)$/i.test(s.trim()));
  if (!boardSheetCandidates.length) {
    throw new RefinedParseError('부품리스트 시트를 찾을 수 없습니다.');
  }

  const toRows = (name: string): Row[] =>
    XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], { header: 1, defval: null });

  // 부품리스트 헤더(품명/SET)가 있는 시트를 찾을 때까지 순서대로 시도
  let board: { items: BOMItem[]; productionQuantity: number } | null = null;
  let boardSheetName = '';
  for (const name of boardSheetCandidates) {
    const parsed = parseBoardSheet(toRows(name));
    if (parsed) { board = parsed; boardSheetName = name; break; }
  }
  if (!board) {
    throw new RefinedParseError('정리본 부품리스트 헤더(번호/종류/품명/SET/수량...)를 찾지 못했습니다. 정리본 형식을 확인해주세요.');
  }

  const topCoordinates = topName ? parseCoordSheet(toRows(topName), 'TOP') : [];
  const bottomCoordinates = bottomName ? parseCoordSheet(toRows(bottomName), 'BOTTOM') : [];

  return {
    bomItems: board.items,
    topCoordinates,
    bottomCoordinates,
    productionQuantity: board.productionQuantity,
    boardSheetName,
  };
}

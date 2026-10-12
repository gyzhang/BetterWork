export type OfficeFactFormat = 'pptx' | 'xlsx' | 'csv';
export type OfficeFactBasis = 'actual' | 'budget';

export interface OfficeFactSource {
  readonly format: OfficeFactFormat;
  readonly locator: string;
  readonly content: unknown;
}

export interface OfficeFactAssertion {
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly period: string;
  readonly basis: OfficeFactBasis;
}

export interface OfficeFactAssertionResult {
  readonly assertions: readonly OfficeFactAssertion[];
  readonly ambiguous: boolean;
}

interface OfficeFactCell {
  readonly row: number;
  readonly column: number;
  readonly value?: unknown;
  readonly valueType: string;
  readonly cachedValueType?: string;
}

interface OfficeFactRow {
  readonly index: number;
  readonly cells: readonly OfficeFactCell[];
}

type OfficeHeaderRole = 'period' | 'metric' | 'unit' | 'value' | 'basis';

interface WideMetricHeader {
  readonly column: number;
  readonly metric: string;
  readonly unit?: string;
  readonly basis: OfficeFactBasis;
}

interface OfficeHeader {
  readonly row: OfficeFactRow;
  readonly columns: ReadonlyMap<OfficeHeaderRole, number>;
  readonly wideMetrics: readonly WideMetricHeader[];
}

interface OfficeHeaderAnalysis {
  readonly header?: OfficeHeader;
  readonly candidate: boolean;
  readonly ambiguous: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cellTypeOf = (value: unknown): string => {
  if (value === null || value === undefined) return 'empty';
  if (value instanceof Date) return 'date';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'other';
};

const columnNumberOf = (letters: string): number =>
  [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);

const xlsxCoordinate = (
  address: string,
): { readonly row: number; readonly column: number } | undefined => {
  const match = /^([A-Z]+)(\d+)$/iu.exec(address);
  const letters = match?.[1];
  const rowText = match?.[2];
  if (!letters || !rowText) return undefined;
  const row = Number(rowText);
  const column = columnNumberOf(letters.toUpperCase());
  return row > 0 && column > 0 ? { row, column } : undefined;
};

const rowsFromXlsx = (content: readonly unknown[]): OfficeFactRow[] => {
  const rows = new Map<number, OfficeFactCell[]>();
  for (const rawCell of content) {
    if (!isRecord(rawCell) || typeof rawCell.address !== 'string') return [];
    const coordinate = xlsxCoordinate(rawCell.address);
    if (!coordinate) return [];
    const valueType =
      typeof rawCell.valueType === 'string' ? rawCell.valueType : cellTypeOf(rawCell.value);
    const cell: OfficeFactCell = {
      row: coordinate.row,
      column: coordinate.column,
      valueType,
      ...(Object.hasOwn(rawCell, 'value') ? { value: rawCell.value } : {}),
      ...(typeof rawCell.cachedValueType === 'string'
        ? { cachedValueType: rawCell.cachedValueType }
        : {}),
    };
    const row = rows.get(coordinate.row);
    if (row) row.push(cell);
    else rows.set(coordinate.row, [cell]);
  }
  return [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, cells]) => ({
      index,
      cells: cells.sort((left, right) => left.column - right.column),
    }));
};

const rowsFromMatrix = (source: OfficeFactSource, content: readonly unknown[]): OfficeFactRow[] => {
  if (!content.every(Array.isArray)) return [];
  let startRow = 1;
  if (source.format === 'csv') {
    const locator = /^rows:(\d+)-(\d+)$/u.exec(source.locator);
    const startText = locator?.[1];
    const endText = locator?.[2];
    if (!startText || !endText) return [];
    startRow = Number(startText);
    const lastRow = Number(endText);
    if (startRow < 1 || lastRow < startRow || content.length > lastRow - startRow + 1) return [];
  }
  return content.map((rawRow, rowOffset) => {
    if (!Array.isArray(rawRow)) return { index: startRow + rowOffset, cells: [] };
    const index = startRow + rowOffset;
    return {
      index,
      cells: rawRow.map((value: unknown, columnOffset: number) => ({
        row: index,
        column: columnOffset + 1,
        value,
        valueType: cellTypeOf(value),
      })),
    };
  });
};

const rowsFromSource = (source: OfficeFactSource): OfficeFactRow[] => {
  if (!Array.isArray(source.content)) return [];
  return source.format === 'xlsx'
    ? rowsFromXlsx(source.content)
    : rowsFromMatrix(source, source.content);
};

const cellAt = (row: OfficeFactRow, column: number | undefined): OfficeFactCell | undefined =>
  column === undefined ? undefined : row.cells.find((cell) => cell.column === column);

const cellText = (cell: OfficeFactCell | undefined): string | undefined => {
  if (!cell || cell.value === undefined || cell.value === null) return undefined;
  if (typeof cell.value === 'string') return cell.value.trim();
  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) return String(cell.value);
  return undefined;
};

const periodText = (cell: OfficeFactCell | undefined): string | undefined => {
  const text = cellText(cell);
  if (cell?.valueType !== 'date' || text === undefined) return text;
  const match = /^((?:19|20)\d{2}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.exec(text);
  const date = match?.[1];
  if (!date) return text;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(`${date}T`)
    ? date
    : text;
};

const normalizedHeader = (value: string): string =>
  value
    .normalize('NFC')
    .trim()
    .replace(/[\s\u3000]/gu, '')
    .replace(/[（]/gu, '(')
    .replace(/[）]/gu, ')')
    .toLowerCase();

const headerRoleOf = (value: string): OfficeHeaderRole | undefined => {
  const header = normalizedHeader(value);
  if (['期间', '月份', '日期', 'period', 'month', 'date'].includes(header)) return 'period';
  if (['指标', 'metric'].includes(header)) return 'metric';
  if (['单位', 'unit'].includes(header)) return 'unit';
  if (['数值', '数额', '金额', '值', 'value', 'amount'].includes(header)) return 'value';
  if (['口径', 'basis'].includes(header)) return 'basis';
  return undefined;
};

const metricHeaderOf = (
  value: string,
  metrics: readonly string[],
  units: readonly string[],
): Omit<WideMetricHeader, 'column'> | undefined => {
  const header = normalizedHeader(value);
  for (const metric of metrics) {
    const normalizedMetric = normalizedHeader(metric);
    for (const unit of units) {
      const unitSuffix = `(${normalizedHeader(unit)})`;
      if (header === `${normalizedMetric}${unitSuffix}`) return { metric, unit, basis: 'actual' };
      if (header === `预算${normalizedMetric}${unitSuffix}`)
        return { metric, unit, basis: 'budget' };
      if (header === `budget${normalizedMetric}${unitSuffix}`)
        return { metric, unit, basis: 'budget' };
    }
  }
  return undefined;
};

const officeHeaderAnalysis = (
  row: OfficeFactRow,
  metrics: readonly string[],
  units: readonly string[],
): OfficeHeaderAnalysis => {
  const columnsByRole = new Map<OfficeHeaderRole, number[]>();
  const wideMetrics: WideMetricHeader[] = [];
  for (const cell of row.cells) {
    const text = cellText(cell);
    if (text === undefined) continue;
    const role = headerRoleOf(text);
    if (role) {
      const columns = columnsByRole.get(role);
      if (columns) columns.push(cell.column);
      else columnsByRole.set(role, [cell.column]);
    }
    const metricHeader = metricHeaderOf(text, metrics, units);
    if (metricHeader) wideMetrics.push({ column: cell.column, ...metricHeader });
  }
  const candidate = columnsByRole.size > 0 || wideMetrics.length > 0;
  if (!candidate) return { candidate: false, ambiguous: false };
  const duplicateRoles = [...columnsByRole.values()].some((columns) => columns.length > 1);
  const conflictingShapes = columnsByRole.has('metric') && wideMetrics.length > 0;
  const missingRequiredRole =
    !columnsByRole.has('period') ||
    (columnsByRole.has('metric') && !columnsByRole.has('value')) ||
    (!columnsByRole.has('metric') && wideMetrics.length === 0);
  if (duplicateRoles || conflictingShapes || missingRequiredRole) {
    return { candidate: true, ambiguous: true };
  }
  const columns = new Map<OfficeHeaderRole, number>();
  for (const [role, values] of columnsByRole) {
    const column = values[0];
    if (column !== undefined) columns.set(role, column);
  }
  return {
    candidate: true,
    ambiguous: false,
    header: { row, columns, wideMetrics },
  };
};

interface ParsedOfficeNumber {
  readonly value: number;
  readonly unit?: string;
}

const parsedOfficeNumber = (
  cell: OfficeFactCell | undefined,
  knownUnits: readonly string[],
): ParsedOfficeNumber | undefined => {
  if (!cell || cell.value === undefined || cell.value === null) return undefined;
  const valueType = cell.valueType === 'formula' ? cell.cachedValueType : cell.valueType;
  if (valueType !== 'number' && valueType !== 'text') return undefined;
  if (typeof cell.value === 'number') {
    return Number.isFinite(cell.value) ? { value: cell.value } : undefined;
  }
  if (typeof cell.value !== 'string') return undefined;
  const match = /^\s*([-+]?(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|\.\d+))\s*(.*?)\s*$/u.exec(
    cell.value,
  );
  const rawValue = match?.[1];
  const rawUnit = match?.[2]?.trim();
  if (!rawValue) return undefined;
  const parsed = Number(rawValue.replaceAll(',', ''));
  if (!Number.isFinite(parsed)) return undefined;
  if (!rawUnit) return { value: parsed };
  const unit = knownUnits.find(
    (candidate) => normalizedHeader(candidate) === normalizedHeader(rawUnit),
  );
  return unit ? { value: parsed, unit } : undefined;
};

const normalizedUnit = (value: string): string =>
  value.normalize('NFC').trim().replaceAll('％', '%');

const basisOf = (value: string | undefined): OfficeFactBasis | undefined => {
  if (value === undefined) return undefined;
  if (['实际', 'actual'].includes(normalizedHeader(value))) return 'actual';
  if (['预算', 'budget'].includes(normalizedHeader(value))) return 'budget';
  return undefined;
};

const assertion = (input: {
  readonly metric: string | undefined;
  readonly period: string | undefined;
  readonly unit: string | undefined;
  readonly value: ParsedOfficeNumber | undefined;
  readonly basis: OfficeFactBasis | undefined;
}): OfficeFactAssertion | undefined => {
  if (
    input.metric === undefined ||
    input.period === undefined ||
    input.unit === undefined ||
    input.value === undefined ||
    input.basis === undefined
  ) {
    return undefined;
  }
  if (input.value.unit && normalizedUnit(input.value.unit) !== normalizedUnit(input.unit)) {
    return undefined;
  }
  return {
    metric: input.metric,
    period: input.period,
    unit: input.value.unit ?? input.unit,
    value: input.value.value,
    basis: input.basis,
  };
};

const rowAssertions = (
  row: OfficeFactRow,
  header: OfficeHeader,
  metrics: readonly string[],
  units: readonly string[],
): OfficeFactAssertion[] => {
  const period = periodText(cellAt(row, header.columns.get('period')));
  const rowUnit = cellText(cellAt(row, header.columns.get('unit')));
  const basisColumn = header.columns.get('basis');
  const basisText = cellText(cellAt(row, basisColumn));
  const rowBasis = basisOf(basisText);
  if (basisColumn !== undefined && rowBasis === undefined) return [];
  const assertions: OfficeFactAssertion[] = [];
  const metricColumn = header.columns.get('metric');
  const valueColumn = header.columns.get('value');
  if (metricColumn !== undefined && valueColumn !== undefined) {
    const metric = cellText(cellAt(row, metricColumn));
    const value = parsedOfficeNumber(cellAt(row, valueColumn), units);
    const result = assertion({
      metric: metrics.find((known) => normalizedHeader(known) === normalizedHeader(metric ?? '')),
      period,
      unit: rowUnit,
      value,
      basis: rowBasis ?? 'actual',
    });
    if (result) assertions.push(result);
  }
  for (const wideMetric of header.wideMetrics) {
    if (wideMetric.unit && rowUnit && normalizedUnit(wideMetric.unit) !== normalizedUnit(rowUnit)) {
      continue;
    }
    if (rowBasis && rowBasis !== wideMetric.basis) continue;
    const value = parsedOfficeNumber(cellAt(row, wideMetric.column), units);
    const result = assertion({
      metric: wideMetric.metric,
      period,
      unit: wideMetric.unit ?? rowUnit,
      value,
      basis: wideMetric.basis,
    });
    if (result) assertions.push(result);
  }
  return assertions;
};

const pptxRowAssertion = (
  row: OfficeFactRow,
  metrics: readonly string[],
  units: readonly string[],
): OfficeFactAssertionResult => {
  const fields = new Map<OfficeHeaderRole, string>();
  const valueCells: OfficeFactCell[] = [];
  let ambiguous = false;
  for (const cell of row.cells) {
    const label = cellText(cell);
    if (label === undefined) continue;
    const role = headerRoleOf(label);
    if (!role) continue;
    const valueCell = cellAt(row, cell.column + 1);
    const value = cellText(valueCell);
    if (value === undefined || fields.has(role)) {
      ambiguous = true;
      continue;
    }
    fields.set(role, value);
    if (role === 'value' && valueCell) valueCells.push(valueCell);
  }
  const metricValue = fields.get('metric');
  const unit = fields.get('unit');
  const basisText = fields.get('basis');
  const basis = basisOf(basisText);
  if (basisText !== undefined && basis === undefined) {
    return { assertions: [], ambiguous: true };
  }
  const result = assertion({
    metric: metrics.find(
      (known) => normalizedHeader(known) === normalizedHeader(metricValue ?? ''),
    ),
    period: fields.get('period'),
    unit,
    value: valueCells.length === 1 ? parsedOfficeNumber(valueCells[0], units) : undefined,
    basis: basis ?? 'actual',
  });
  return { assertions: result ? [result] : [], ambiguous };
};

export const officeFactAssertionsIn = (
  source: OfficeFactSource,
  metrics: readonly string[],
  units: readonly string[],
): OfficeFactAssertionResult => {
  const rows = rowsFromSource(source);
  if (source.format === 'pptx') {
    const results = rows.map((row) => pptxRowAssertion(row, metrics, units));
    return {
      assertions: results.flatMap((result) => result.assertions),
      ambiguous: results.some((result) => result.ambiguous),
    };
  }
  const headerAnalyses = rows.map((row) => officeHeaderAnalysis(row, metrics, units));
  const headers = headerAnalyses.flatMap((analysis) => (analysis.header ? [analysis.header] : []));
  const ambiguous = headerAnalyses.some((analysis) => analysis.ambiguous) || headers.length > 1;
  if (ambiguous || headers.length !== 1) return { assertions: [], ambiguous };
  const header = headers[0];
  if (!header) return { assertions: [], ambiguous: false };
  return {
    assertions: rows
      .filter((row) => row.index > header.row.index)
      .flatMap((row) => rowAssertions(row, header, metrics, units)),
    ambiguous: false,
  };
};

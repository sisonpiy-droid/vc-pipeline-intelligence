// Reads the Excel workbook. exceljs is a devDependency: this module is only imported by
// scripts/import.ts and tests, never by the Next.js app, so it is not part of the serverless bundle.
type SheetRow = Record<string, unknown>;

function cellValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    return o.text ?? o.result ?? o.hyperlink ?? null;
  }
  return v;
}

export async function readWorkbook(path: string): Promise<{ vc: SheetRow[]; angels: SheetRow[] }> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);

  const sheet = (name: string): SheetRow[] => {
    const ws = wb.getWorksheet(name);
    if (!ws) throw new Error(`Workbook has no sheet named "${name}" (found: ${wb.worksheets.map((w) => w.name).join(", ")})`);
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (headers[i - 1] = String(cellValue(c.value) ?? "").trim()));
    const rows: SheetRow[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const o: SheetRow = {};
      headers.forEach((h, i) => h && (o[h] = cellValue(row.getCell(i + 1).value)));
      if (Object.values(o).some((v) => v !== null && String(v).trim() !== "")) rows.push(o);
    });
    return rows;
  };

  return { vc: sheet("VC Firms"), angels: sheet("Angel Investors") };
}

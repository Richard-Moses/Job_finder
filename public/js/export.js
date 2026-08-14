/**
 * Builds an .xlsx workbook in the browser with ExcelJS and triggers a
 * download -- no server round-trip, no file storage. Mirrors the formatting
 * choices already used in export_healthjobsuk_excel.py / scrape_dailyremote.py:
 * bold header fill, frozen header row, autofilter, hyperlinked URL column,
 * and -- important lesson learned earlier in this project -- a fixed,
 * un-wrapped row height so long description fields don't blow rows out to
 * dozens of lines tall.
 */

async function buildAndDownloadExcel(jobs, columns, sheetName, filename, urlKey) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 20 }));

  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    cell.alignment = { vertical: "middle" };
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  jobs.forEach((job) => {
    const row = sheet.addRow(job);
    row.height = 18;
    row.eachCell((cell) => {
      cell.alignment = { wrapText: false, vertical: "middle" };
    });
  });

  if (urlKey) {
    const col = sheet.getColumn(urlKey);
    col.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber === 1 || !cell.value) return;
      const href = String(cell.value);
      cell.value = { text: href, hyperlink: href };
      cell.font = { color: { argb: "FF0563C1" }, underline: true };
    });
  }

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

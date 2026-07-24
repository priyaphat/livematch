const COLORS = {
  green: "FF15803D",
  greenLight: "FFDCFCE7",
  stone: "FF44403C",
  white: "FFFFFFFF",
};

const bookingStatuses = {
  hold: "กำลังจอง",
  pending_review: "รอตรวจสอบ",
  confirmed: "ยืนยันแล้ว",
  rejected: "ไม่อนุมัติ",
  cancelled: "ยกเลิก",
  expired: "หมดเวลา",
};

const paymentStatuses = {
  unpaid: "ยังไม่ชำระ",
  pending: "รอตรวจสอบ",
  paid: "ชำระแล้ว",
  rejected: "ไม่ผ่าน",
  approved: "อนุมัติแล้ว",
  manual_paid: "บันทึกชำระโดยผู้ดูแล",
};

function statusLabel(value, type = "booking") {
  if (!value) return "-";
  return (type === "payment" ? paymentStatuses : bookingStatuses)[value] || "-";
}

function boolLabel(value, yes = "ใช่", no = "ไม่ใช่") {
  return value ? yes : no;
}

function localDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addTitle(sheet, title, columnCount) {
  const row = sheet.addRow([title]);
  sheet.mergeCells(row.number, 1, row.number, columnCount);
  row.height = 28;
  row.getCell(1).font = { bold: true, size: 16, color: { argb: COLORS.white } };
  row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.green } };
}

function addMeta(sheet, rows, columnCount) {
  for (const row of rows) {
    const added = sheet.addRow(row);
    added.getCell(1).font = { bold: true, color: { argb: COLORS.stone } };
  }
  sheet.addRow([]);
  sheet.views = [{ state: "frozen", ySplit: sheet.rowCount }];
  sheet.pageSetup = {
    orientation: columnCount > 8 ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
}

function addTable(sheet, headers, rows, currencyColumns = []) {
  const header = sheet.addRow(headers);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.stone } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  rows.forEach((values) => {
    const row = sheet.addRow(values);
    row.eachCell((cell, index) => {
      if (currencyColumns.includes(index)) cell.numFmt = "#,##0";
      cell.alignment = { vertical: "top", wrapText: true };
    });
  });
  sheet.autoFilter = {
    from: { row: header.number, column: 1 },
    to: { row: header.number, column: headers.length },
  };
}

function finishSheet(sheet) {
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = { bottom: { style: "hair", color: { argb: "FFD6D3D1" } } };
    });
  });
  sheet.columns.forEach((column, index) => {
    let width = index === 0 ? 14 : 12;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const length = String(cell.value ?? "").length + 2;
      width = Math.max(width, Math.min(length, 42));
    });
    column.width = width;
  });
}

async function createWorkbook() {
  const module = await import("exceljs");
  const Workbook = module.Workbook || module.default?.Workbook;
  const workbook = new Workbook();
  workbook.creator = "LiveMatch";
  workbook.created = new Date();
  return workbook;
}

async function saveWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function buildMembersAdminWorkbook(data, options = {}) {
  const workbook = await createWorkbook();
  const generatedAt = data.generatedAt ? new Date(data.generatedAt).toLocaleString("th-TH") : "-";
  const reportType = options.reportType || "all";
  const selectedMember = (data.members || []).find((item) => item.id === options.memberId);
  const memberRowsOnly = (items) =>
    options.memberId ? (items || []).filter((item) => item.memberId === options.memberId) : (items || []);
  const memberMeta = selectedMember ? [["สมาชิก", selectedMember.name]] : [];

  const memberHeaders = [
    "ชื่อ", "เบอร์โทร", "อีเมล", "ประเภทสมาชิก", "สถานะ",
    "เชื่อม Google", "วันที่สมัคร", "แก้ไขล่าสุด", "รายการผู้เล่น",
    "จำนวนการจอง", "รายการชำระเงิน", "ยอดจองที่อนุมัติ (บาท)",
  ];
  const memberRows = (data.members || []).map((item) => [
    item.name, item.phone, item.email || "-", item.memberType === "club" ? "สมาชิกชมรม" : "สมาชิกทั่วไป",
    item.active ? "ใช้งาน" : "ปิดใช้งาน", boolLabel(item.linked), item.createdAt, item.updatedAt,
    item.playerCount, item.bookingCount, item.paymentCount, Number(item.approvedAmountThb || 0),
  ]);
  const members = workbook.addWorksheet("รายชื่อสมาชิก");
  addTitle(members, "รายงานรายชื่อสมาชิกทั้งหมด", memberHeaders.length);
  addMeta(members, [["วันที่สร้างรายงาน", generatedAt], ["จำนวนสมาชิก", memberRows.length]], memberHeaders.length);
  addTable(members, memberHeaders, memberRows, [12]);
  finishSheet(members);

  const bookingHeaders = [
    "ชื่อผู้จอง", "เบอร์โทร", "อีเมล",
    "สนาม", "สร้างโดย", "เวลาเริ่ม", "เวลาสิ้นสุด", "ช่วงเวลา (นาที)",
    "ราคาต่อช่วง", "ยอดรวม", "สถานะการจอง", "สถานะชำระเงิน", "หมายเหตุ", "สร้างเมื่อ",
  ];
  const bookingRows = memberRowsOnly(data.bookings).map((item) => [
    item.memberName, item.phone || "-", item.email || "-",
    item.courtName, item.bookedBy === "admin" ? "Admin" : "สมาชิก", item.startAt, item.endAt,
    item.intervalMinutes, Number(item.unitPriceThb || 0), Number(item.totalPriceThb || 0),
    statusLabel(item.status), statusLabel(item.paymentStatus, "payment"), item.note || "", item.createdAt,
  ]);
  const bookings = workbook.addWorksheet("รายละเอียดการจอง");
  addTitle(bookings, "รายละเอียดการจองของสมาชิก", bookingHeaders.length);
  addMeta(bookings, [...memberMeta, ["วันที่สร้างรายงาน", generatedAt], ["จำนวนรายการ", bookingRows.length]], bookingHeaders.length);
  addTable(bookings, bookingHeaders, bookingRows, [9, 10]);
  finishSheet(bookings);

  const paymentHeaders = [
    "ประเภท", "ชื่อ", "เบอร์โทร", "อีเมล",
    "ยอดเงิน", "สถานะ", "เวลาบันทึก/โอน", "เวลาตรวจสอบ", "ผู้ตรวจสอบ", "หมายเหตุ",
  ];
  const paymentRows = memberRowsOnly(data.payments).map((item) => [
    item.kind === "booking" ? "จองสนาม" : "Match", item.memberName,
    item.phone || "-", item.email || "-", Number(item.amountThb || 0),
    statusLabel(item.status, "payment"), item.createdAt, item.reviewedAt || "-", item.reviewedBy || "-", item.note || "",
  ]);
  const payments = workbook.addWorksheet("การชำระเงิน");
  addTitle(payments, "ประวัติการชำระเงิน", paymentHeaders.length);
  addMeta(payments, [...memberMeta, ["วันที่สร้างรายงาน", generatedAt], ["จำนวนรายการ", paymentRows.length]], paymentHeaders.length);
  addTable(payments, paymentHeaders, paymentRows, [5]);
  finishSheet(payments);

  const matchHeaders = [
    "ชื่อสมาชิก", "เบอร์โทร", "ชื่อผู้เล่น", "ชื่อ Session",
    "เกมที่", "สนาม", "เวลาเริ่ม", "เวลาสิ้นสุด", "สถานะ", "ผู้ชนะ",
    "เกมรวมของผู้เล่น", "ชนะ", "เสมอ", "แพ้", "สถานะจ่ายเงิน",
  ];
  const matchRows = memberRowsOnly(data.matches).map((item) => [
    item.memberName, item.phone || "-", item.playerName,
    item.sessionName, item.matchId, item.court, item.startedAt,
    item.endedAt, item.status === "cancelled" ? "ยกเลิก" : "จบการแข่งขัน",
    item.winner || "-", item.games, item.wins, item.draws, item.losses,
    item.paid ? "จ่ายแล้ว" : "ค้างชำระ",
  ]);
  const matches = workbook.addWorksheet("ประวัติ Match");
  addTitle(matches, "ประวัติ Match ของสมาชิก", matchHeaders.length);
  addMeta(matches, [...memberMeta, ["วันที่สร้างรายงาน", generatedAt], ["จำนวนรายการ", matchRows.length]], matchHeaders.length);
  addTable(matches, matchHeaders, matchRows);
  finishSheet(matches);

  if (reportType !== "all") {
    const selectedSheet = {
      members: "รายชื่อสมาชิก",
      bookings: "รายละเอียดการจอง",
      payments: "การชำระเงิน",
      matches: "ประวัติ Match",
    }[reportType];
    workbook.worksheets
      .filter((sheet) => sheet.name !== selectedSheet)
      .forEach((sheet) => workbook.removeWorksheet(sheet.id));
  }
  return workbook;
}

export async function exportMembersAdminExcel(apiRequest, options = {}, sourceData = null) {
  const data = sourceData || await apiRequest("/api/admin/members/export");
  const workbook = await buildMembersAdminWorkbook(data, options);
  const selectedMember = (data.members || []).find((item) => item.id === options.memberId);
  const reportName = options.reportType || "members";
  const memberName = selectedMember
    ? `-${String(selectedMember.name).trim().replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "-")}`
    : "";
  await saveWorkbook(workbook, `livematch-${reportName}${memberName}-${localDateStamp()}.xlsx`);
}

export async function buildBookingAdminWorkbook(data) {
  const workbook = await createWorkbook();
  const headers = [
    "ชื่อผู้จอง", "เบอร์โทร", "อีเมล",
    "สร้างโดย", "สนาม", "เวลาเริ่ม", "เวลาสิ้นสุด", "ช่วงเวลา (นาที)",
    "ราคาต่อช่วง", "ยอดจอง", "สถานะการจอง", "สถานะชำระเงิน", "หมายเหตุการจอง",
    "สร้างรายการเมื่อ", "แก้ไขรายการล่าสุด", "ยอดชำระ",
    "สถานะตรวจชำระ", "เวลาโอน/อัปโหลด", "เวลาอนุมัติ", "ผู้อนุมัติ", "หมายเหตุการชำระ",
  ];
  const rows = (data.items || []).map((item) => [
    item.bookerName, item.phone || "-", item.email || "-",
    item.bookedBy === "admin" ? "Admin" : "สมาชิก",
    item.courtName, item.startAt, item.endAt, item.intervalMinutes,
    Number(item.unitPriceThb || 0), Number(item.totalPriceThb || 0),
    statusLabel(item.bookingStatus), statusLabel(item.paymentStatus, "payment"),
    item.bookingNote || "", item.bookingCreatedAt, item.bookingUpdatedAt,
    Number(item.paymentAmountThb || 0), statusLabel(item.paymentReviewStatus, "payment"),
    item.transferredAt || "-", item.approvedAt || "-", item.reviewedBy || "-", item.paymentNote || "",
  ]);
  const sheet = workbook.addWorksheet("รายการจองสนาม");
  addTitle(sheet, "รายงานรายละเอียดการจองสนาม", headers.length);
  addMeta(sheet, [
    ["วันที่เริ่มต้น", data.startDate],
    ["วันที่สิ้นสุด", data.endDate],
    ["สถานะที่เลือก", data.status === "all" ? "ทั้งหมด" : statusLabel(data.status)],
    ["วันที่สร้างรายงาน", data.generatedAt ? new Date(data.generatedAt).toLocaleString("th-TH") : "-"],
    ["จำนวนรายการ", rows.length],
  ], headers.length);
  addTable(sheet, headers, rows, [9, 10, 16]);
  finishSheet(sheet);
  return workbook;
}

export async function exportBookingAdminExcel(apiRequest, filters) {
  const params = new URLSearchParams({
    startDate: filters.startDate,
    endDate: filters.endDate,
    status: filters.status || "all",
  });
  const data = await apiRequest(`/api/admin/booking/export?${params.toString()}`);
  const workbook = await buildBookingAdminWorkbook(data);
  await saveWorkbook(
    workbook,
    `livematch-bookings-${data.startDate}-to-${data.endDate}.xlsx`,
  );
}

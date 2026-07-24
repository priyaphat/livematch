import { describe, expect, it } from "vitest";
import {
  buildBookingAdminWorkbook,
  buildMembersAdminWorkbook,
} from "./adminExcelExport";

describe("admin Excel exports", () => {
  it("creates all member detail sheets", async () => {
    const workbook = await buildMembersAdminWorkbook({
      generatedAt: "2026-07-24T10:00:00+07:00",
      members: [{ id: "m1", name: "ปุ้ย", phone: "0812345678", memberType: "general", active: true }],
      bookings: [{ id: "b1", memberName: "ปุ้ย", courtName: "สนาม 1", status: "confirmed", paymentStatus: "paid" }],
      payments: [{ kind: "booking", referenceId: "b1", memberName: "ปุ้ย", amountThb: 100, status: "approved" }],
      matches: [{ memberId: "m1", memberName: "ปุ้ย", playerName: "ปุ้ย", sessionName: "Friday", matchId: 1 }],
    });

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "รายชื่อสมาชิก",
      "รายละเอียดการจอง",
      "การชำระเงิน",
      "ประวัติ Match",
    ]);
    const exportedText = [];
    workbook.worksheets.forEach((sheet) =>
      sheet.eachRow((row) => row.eachCell((cell) => exportedText.push(String(cell.value ?? "")))),
    );
    expect(exportedText).not.toContain("รหัสสมาชิก");
    expect(exportedText).not.toContain("Booking ID");
    expect(exportedText).not.toContain("Payment ID");
    expect(exportedText).not.toContain("Session ID");
    expect(exportedText).not.toContain("m1");
    expect(exportedText).not.toContain("b1");
    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });

  it("creates booking details without exporting receipt data", async () => {
    const workbook = await buildBookingAdminWorkbook({
      generatedAt: "2026-07-24T10:00:00+07:00",
      startDate: "2026-07-24",
      endDate: "2026-07-24",
      status: "all",
      items: [{
        bookingId: "b1",
        bookerName: "ปุ้ย",
        courtName: "สนาม 1",
        startAt: "2026-07-24 18:00",
        endAt: "2026-07-24 19:00",
        totalPriceThb: 100,
        bookingStatus: "confirmed",
        paymentStatus: "paid",
        transferredAt: "2026-07-24 17:50",
        approvedAt: "2026-07-24 17:55",
        slipData: "data:image/png;base64,SECRET",
      }],
    });

    const sheet = workbook.getWorksheet("รายการจองสนาม");
    expect(sheet).toBeTruthy();
    const values = [];
    sheet.eachRow((row) => row.eachCell((cell) => values.push(String(cell.value ?? ""))));
    expect(values.join(" ")).toContain("ปุ้ย");
    expect(values).not.toContain("Booking ID");
    expect(values).not.toContain("Batch ID");
    expect(values).not.toContain("Court ID");
    expect(values).not.toContain("Payment ID");
    expect(values).not.toContain("b1");
    expect(values.join(" ")).not.toContain("SECRET");
  });

  it("creates one selected member report and excludes other members", async () => {
    const workbook = await buildMembersAdminWorkbook({
      generatedAt: "2026-07-24T10:00:00+07:00",
      members: [
        { id: "m1", name: "ปุ้ย", phone: "0811111111" },
        { id: "m2", name: "เจ", phone: "0822222222" },
      ],
      bookings: [
        { memberId: "m1", memberName: "ปุ้ย", courtName: "สนาม 1", status: "confirmed" },
        { memberId: "m2", memberName: "เจ", courtName: "สนาม 2", status: "confirmed" },
      ],
      payments: [],
      matches: [],
    }, { reportType: "bookings", memberId: "m1" });

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["รายละเอียดการจอง"]);
    const values = [];
    workbook.worksheets[0].eachRow((row) =>
      row.eachCell((cell) => values.push(String(cell.value ?? ""))),
    );
    expect(values).toContain("ปุ้ย");
    expect(values).not.toContain("เจ");
    expect(values).not.toContain("m1");
  });
});

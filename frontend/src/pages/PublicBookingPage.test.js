import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import PublicBookingPage from "./PublicBookingPage.vue";

function availability() {
  return {
    date: "2026-07-22",
    settings: {
      openTime: "16:00",
      closeTime: "19:00",
      intervalMinutes: 60,
      allowOvernight: false,
    },
    courts: [
      { id: "court-1", name: "สนาม 1", pricePerInterval: 100 },
      { id: "court-2", name: "สนาม 2", pricePerInterval: 120 },
      { id: "court-3", name: "สนาม 3", pricePerInterval: 100 },
    ],
    bookings: [
      {
        id: "hold-1",
        courtId: "court-2",
        startAt: "2026-07-22T16:00:00+07:00",
        endAt: "2026-07-22T17:00:00+07:00",
        status: "hold",
        holdExpiresAt: "2026-07-22T23:59:00+07",
      },
      {
        id: "pending-1",
        courtId: "court-2",
        startAt: "2026-07-22T17:00:00+07:00",
        endAt: "2026-07-22T18:00:00+07:00",
        status: "pending_review",
      },
    ],
    closures: [],
  };
}

function apiMock({ holdError = false, queues = [] } = {}) {
  return vi.fn((url) => {
    if (url.includes("/availability")) return Promise.resolve(availability());
    if (url.includes("/mine")) return Promise.resolve({ items: queues });
    if (url.includes("/public-auth/me"))
      return Promise.resolve({
        user: { name: "User" },
        member: {
          name: "สมาชิก",
          phone: "0882250419",
          profileToken: "profile-token",
        },
      });
    if (url.includes("/hold") && holdError)
      return Promise.reject(new Error("ช่วงเวลานี้ถูกล็อกไปแล้ว"));
    if (url.includes("/hold"))
      return Promise.resolve({
        batchId: "batch-1",
        bookings: [{ id: "booking-1", totalPriceThb: 100, status: "hold" }],
        totalPriceThb: 100,
        promptPayPayload: "",
      });
    return Promise.resolve({});
  });
}

describe("PublicBookingPage", () => {
  it("lists an active booking before the schedule and reopens its payment QR", async () => {
    const apiRequest = apiMock({
      queues: [
        {
          id: "batch-active",
          status: "hold",
          holdExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          totalPriceThb: 200,
          startAt: "2026-07-22T18:00:00+07:00",
          endAt: "2026-07-22T20:00:00+07:00",
          courtNames: ["สนาม 2"],
          promptPayPayload: "00020101021253037645406200.00",
        },
        {
          id: "batch-pending",
          status: "pending_review",
          totalPriceThb: 100,
          startAt: "2026-07-22T20:00:00+07:00",
          endAt: "2026-07-22T21:00:00+07:00",
          courtNames: ["สนาม 3"],
        },
      ],
    });
    const wrapper = mount(PublicBookingPage, {
      props: { apiRequest, token: "tenant-token" },
    });
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="active-booking-queues"]').text()).toContain(
        "รายการจองที่กำลังดำเนินการ",
      ),
    );
    expect(wrapper.get('[data-testid="active-booking-queues"]').text()).toContain("สนาม 2");
    expect(wrapper.get('[data-testid="active-booking-queues"]').text()).not.toContain("สนาม 3");
    expect(wrapper.get('[data-testid="active-booking-queues"]').text()).not.toContain("รอตรวจสอบ");
    const reopenButton = wrapper
      .get('[data-testid="active-booking-queues"]')
      .findAll("button")
      .find((button) => button.text().includes("แสดง QR"));
    await reopenButton.trigger("click");
    await vi.waitFor(() => expect(wrapper.find('img[alt="QR PromptPay"]').exists()).toBe(true));
    expect(wrapper.text()).toContain("ชำระ ฿200");
    wrapper.unmount();
  });

  it("shows a toast and returns to today when another date is rejected", async () => {
    const currentDate = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Bangkok",
    });
    let availabilityCalls = 0;
    const apiRequest = vi.fn((url) => {
      if (url.includes("/availability")) {
        availabilityCalls += 1;
        if (availabilityCalls === 2) {
          const error = new Error("ระบบเปิดให้จองได้เฉพาะวันนี้");
          error.status = 403;
          return Promise.reject(error);
        }
        const payload = availability();
        payload.date = currentDate;
        payload.settings.allowOvernight = availabilityCalls === 1;
        return Promise.resolve(payload);
      }
      if (url.includes("/public-auth/me"))
        return Promise.resolve({
          user: { name: "User" },
          member: { name: "สมาชิก", phone: "0882250419" },
        });
      return Promise.resolve({});
    });
    const wrapper = mount(PublicBookingPage, {
      props: { apiRequest, token: "tenant-token" },
    });
    await vi.waitFor(() =>
      expect(wrapper.get('input[type="date"]').attributes("disabled")).toBeUndefined(),
    );
    await wrapper.get('button[aria-label="วันถัดไป"]').trigger("click");
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="booking-toast"]').text()).toContain(
        "ระบบเปิดให้จองได้เฉพาะวันนี้",
      ),
    );
    expect(wrapper.get('input[type="date"]').element.value).toBe(currentDate);
    expect(wrapper.get('input[type="date"]').attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("disables every date control when booking across days is off", async () => {
    const apiRequest = apiMock();
    const wrapper = mount(PublicBookingPage, {
      props: { apiRequest, token: "tenant-token" },
    });
    await vi.waitFor(() =>
      expect(wrapper.find('input[type="date"]').attributes("disabled")).toBeDefined(),
    );
    expect(wrapper.findAll(".booking-date-arrow")).toHaveLength(2);
    expect(
      wrapper.findAll(".booking-date-arrow").every((button) => button.attributes("disabled") !== undefined),
    ).toBe(true);
    expect(wrapper.get(".booking-today-button").attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("separates statuses and supports independent multi-court slot selection", async () => {
    const wrapper = mount(PublicBookingPage, {
      props: { apiRequest: apiMock(), token: "tenant-token" },
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain("สนาม 1"));

    expect(wrapper.text()).toContain("กำลังจอง");
    expect(wrapper.text()).toContain("รอตรวจสอบ");
    expect(wrapper.find(".public-slot--hold").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("NaN");
    expect(wrapper.find(".public-slot--pending").exists()).toBe(true);

    const firstSlot = wrapper.get('[data-testid="slot-court-1-960"]');
    await firstSlot.trigger("click");
    expect(wrapper.find('[data-testid="booking-summary"]').exists()).toBe(true);
    expect(firstSlot.attributes("aria-pressed")).toBe("true");

    await wrapper.get('[data-testid="slot-court-1-1020"]').trigger("click");
    expect(wrapper.get('[data-testid="booking-summary"]').text()).toContain(
      "120 นาที",
    );
    expect(wrapper.get('[data-testid="booking-summary"]').text()).toContain(
      "฿200",
    );

    await firstSlot.trigger("click");
    expect(firstSlot.attributes("aria-pressed")).toBe("false");
    expect(wrapper.get('[data-testid="booking-summary"]').text()).toContain(
      "60 นาที",
    );
    await wrapper.get('[data-testid="slot-court-1-1020"]').trigger("click");
    expect(wrapper.find('[data-testid="booking-summary"]').exists()).toBe(
      false,
    );

    await firstSlot.trigger("click");
    const otherCourtSlot = wrapper.get('[data-testid="slot-court-3-1020"]');
    await otherCourtSlot.trigger("click");
    expect(firstSlot.attributes("aria-pressed")).toBe("true");
    expect(otherCourtSlot.attributes("aria-pressed")).toBe("true");
    expect(wrapper.get('[data-testid="booking-summary"]').text()).toContain(
      "2 ช่วง",
    );
    expect(wrapper.get('[data-testid="booking-summary"]').text()).toContain("฿200");
    wrapper.unmount();
  });

  it("shows a toast and refreshes availability when hold creation loses the race", async () => {
    const apiRequest = apiMock({ holdError: true });
    const wrapper = mount(PublicBookingPage, {
      props: { apiRequest, token: "tenant-token" },
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain("สนาม 1"));
    await wrapper.get('[data-testid="slot-court-1-960"]').trigger("click");
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("ล็อกเวลาทั้งหมด 5 นาที"))
      .trigger("click");
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="booking-toast"]').text()).toContain(
        "ช่วงเวลานี้ถูกล็อกไปแล้ว",
      ),
    );
    expect(wrapper.find('[data-testid="booking-summary"]').exists()).toBe(
      false,
    );
    expect(
      apiRequest.mock.calls.filter(([url]) => url.includes("/availability"))
        .length,
    ).toBeGreaterThan(1);
    wrapper.unmount();
  });
});

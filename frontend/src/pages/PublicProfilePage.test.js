import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import PublicProfilePage from "./PublicProfilePage.vue";

describe("PublicProfilePage", () => {
  it("shows booking and slip upload actions for an active hold", async () => {
    const apiRequest = vi.fn(() =>
      Promise.resolve({
        member: {
          name: "สมาชิก",
          phone: "0882250419",
          email: "member@example.com",
          active: true,
        },
        bookingToken: "booking-token",
        bookings: [
          {
            id: "booking-1",
            courtName: "สนาม 2",
            startAt: "2026-07-23T19:00:00+07:00",
            endAt: "2026-07-23T20:00:00+07:00",
            holdExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            totalPriceThb: 100,
            status: "hold",
          },
        ],
        payments: [],
        matches: [],
      }),
    );
    const wrapper = mount(PublicProfilePage, {
      props: { apiRequest, token: "profile-token" },
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain("สนาม 2"));

    expect(wrapper.text()).toContain("จองสนาม");
    expect(wrapper.text()).toContain("อัปโหลดสลิป");
    expect(wrapper.text()).toContain("เหลือ ");
    expect(wrapper.text()).toContain(" นาที");
    expect(wrapper.find('input[type="file"]').attributes("accept")).toBe(
      "image/jpeg,image/png,image/webp",
    );
    wrapper.unmount();
  });
});

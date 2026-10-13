import { describe, expect, it } from "vitest";
import { renderTemplate, type TemplateData } from "@/emails/templates";
import { renderEmailHtml, renderEmailText } from "@/emails/render";

describe("email template rendering", () => {
  it("renders event-registration-confirmation with complete event details", () => {
    const data: TemplateData = {
      displayName: "Aarav Sharma",
      eventName: "RoboWars 2026",
      publicRegistrationCode: "PR-ROBO01",
      publicOrderCode: "PO-ORD123",
      eventDateTime: "25 Aug 2026, 10:00 AM – 01:00 PM IST",
      venue: "Main Auditorium, Campus",
      teamName: "Cyber Knights",
      teamMembers: ["Aarav Sharma (Captain)", "Priya Patel", "Rohan Gupta"],
      amountPaise: 150000,
      currency: "INR",
      dashboardUrl: "https://tarang.example.com/dashboard",
      supportEmail: "support@tarang.example.com",
    };

    const { subject, element } = renderTemplate("event-registration-confirmation", data);
    expect(subject).toBe("Registration Confirmed: RoboWars 2026 (PR-ROBO01)");

    const html = renderEmailHtml(element);
    const text = renderEmailText(html);

    expect(html).toContain("RoboWars 2026");
    expect(html).toContain("PR-ROBO01");
    expect(html).toContain("PO-ORD123");
    expect(html).toContain("25 Aug 2026, 10:00 AM – 01:00 PM IST");
    expect(html).toContain("Main Auditorium, Campus");
    expect(html).toContain("Cyber Knights");
    expect(html).toContain("Aarav Sharma (Captain), Priya Patel, Rohan Gupta");
    expect(html).toContain("₹1,500 INR");

    expect(text).toContain("RoboWars 2026");
    expect(text).toContain("PR-ROBO01");
    expect(text).toContain("Main Auditorium, Campus");
  });

  it("renders team-member-registration with complete event and team details", () => {
    const data: TemplateData = {
      displayName: "Priya Patel",
      eventName: "RoboWars 2026",
      publicRegistrationCode: "PR-ROBO01",
      eventDateTime: "25 Aug 2026, 10:00 AM – 01:00 PM IST",
      venue: "Main Auditorium, Campus",
      teamName: "Cyber Knights",
      teamMembers: ["Aarav Sharma (Captain)", "Priya Patel", "Rohan Gupta"],
      dashboardUrl: "https://tarang.example.com/dashboard",
      supportEmail: "support@tarang.example.com",
    };

    const { subject, element } = renderTemplate("team-member-registration", data);
    expect(subject).toBe("You're registered for RoboWars 2026 (PR-ROBO01)");

    const html = renderEmailHtml(element);
    const text = renderEmailText(html);

    expect(html).toContain("RoboWars 2026");
    expect(html).toContain("PR-ROBO01");
    expect(html).toContain("Cyber Knights");
    expect(html).toContain("Main Auditorium, Campus");
    expect(html).toContain("Aarav Sharma (Captain), Priya Patel, Rohan Gupta");

    expect(text).toContain("RoboWars 2026");
    expect(text).toContain("Priya Patel");
    expect(text).toContain("Cyber Knights");
  });

  it("renders delegate-pass-confirmation with provider payment reference", () => {
    const data: TemplateData = {
      displayName: "Anurag Sharma",
      publicPassCode: "PP-VIP-001",
      publicOrderCode: "PO-ORD999",
      productName: "VIP All-Access Delegate Pass",
      amountPaise: 200000,
      currency: "INR",
      providerReference: "pay_RazorpayRef123",
      dashboardUrl: "https://tarang.example.com/dashboard",
      supportEmail: "support@tarang.example.com",
    };

    const { subject, element } = renderTemplate("delegate-pass-confirmation", data);
    expect(subject).toContain("PP-VIP-001");

    const html = renderEmailHtml(element);
    const text = renderEmailText(html);

    expect(html).toContain("PP-VIP-001");
    expect(html).toContain("PO-ORD999");
    expect(html).toContain("pay_RazorpayRef123");
    expect(html).toContain("Payment Ref");

    expect(text).toContain("PP-VIP-001");
    expect(text).toContain("pay_RazorpayRef123");
  });
});

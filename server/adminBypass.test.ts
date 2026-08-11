const adminMobile = process.env.ADMIN_MOBILE;
const describeWithAdminMobile = adminMobile ? describe : describe.skip;

describeWithAdminMobile("Admin mobile configuration", () => {
  it("uses a valid E.164-compatible phone number when ADMIN_MOBILE is configured", () => {
    expect(adminMobile).toMatch(/^\+?\d{10,15}$/);
  });

  it("uses the configured Indian +91 mobile format when ADMIN_MOBILE is configured", () => {
    expect(adminMobile).toMatch(/^\+91\d{10}$/);
  });
});

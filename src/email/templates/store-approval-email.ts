export function storeApprovalEmailTemplate(
  firstName: string,
  storeName: string,
  dashboardUrl: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your store has been approved! Time to add your products</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background-color:#0a0a0a;padding:32px 48px;text-align:center;">
              <span style="font-size:26px;font-weight:bold;letter-spacing:6px;color:#ffffff;">YIIVA</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:48px;">
              <p style="margin:0 0 16px 0;font-size:16px;color:#111111;">Hi ${firstName},</p>
              <p style="margin:0 0 12px 0;font-size:16px;color:#333333;line-height:1.7;">
                Great news — <strong>${storeName}</strong> has passed our first review and your merchant account is now active.
              </p>
              <p style="margin:0 0 28px 0;font-size:16px;color:#333333;line-height:1.7;">
                You can now access your merchant dashboard to add products, refine your branding, and get your store ready for launch. Your store is <strong>not yet visible to buyers</strong> — it will go live after a short second review to make sure everything is in order.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px 0;">
                <tr>
                  <td style="background-color:#0a0a0a;border-radius:4px;">
                    <a href="${dashboardUrl}"
                       style="display:inline-block;padding:14px 36px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">
                      Go to my dashboard
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px 0;font-size:14px;color:#555555;line-height:1.7;">Here's what to do to get your store live:</p>
              <ul style="margin:0 0 28px 0;padding-left:20px;font-size:14px;color:#555555;line-height:2;">
                <li>Add at least 7 active products</li>
                <li>Upload your store banner</li>
                <li>Write your brand story</li>
                <li>Add at least one store address</li>
                <li>Request go-live when you're ready</li>
              </ul>

              <p style="margin:0;font-size:14px;color:#777777;line-height:1.7;">
                Welcome to YIIVA. We're glad to have you here.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 48px;border-top:1px solid #eeeeee;">
              <p style="margin:0;font-size:12px;color:#aaaaaa;text-align:center;">
                Questions? Contact <a href="mailto:support@yiiva.co.za" style="color:#aaaaaa;">support@yiiva.co.za</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function storeLiveEmailTemplate(
  firstName: string,
  storeName: string,
  storeUrl: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your store is now live on YIIVA!</title>
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
              <p style="margin:0 0 12px 0;font-size:22px;font-weight:bold;color:#111111;line-height:1.4;">
                Your store is live.
              </p>
              <p style="margin:0 0 28px 0;font-size:16px;color:#333333;line-height:1.7;">
                <strong>${storeName}</strong> is now visible to buyers on YIIVA. You're officially open for business.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px 0;">
                <tr>
                  <td style="background-color:#0a0a0a;border-radius:4px;">
                    <a href="${storeUrl}"
                       style="display:inline-block;padding:14px 36px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">
                      View my store
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px 0;font-size:14px;color:#555555;line-height:1.7;">Here's what to do next:</p>
              <ul style="margin:0 0 28px 0;padding-left:20px;font-size:14px;color:#555555;line-height:2;">
                <li>Share your store link with your audience</li>
                <li>Keep your inventory updated and add new products regularly</li>
                <li>Respond promptly to orders and customer questions</li>
                <li>Monitor your reviews and ratings from the dashboard</li>
              </ul>

              <p style="margin:0;font-size:14px;color:#777777;line-height:1.7;">
                Welcome to the marketplace. We're excited to see what you build.
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

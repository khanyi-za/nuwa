export function storeRejectionEmailTemplate(
  firstName: string,
  storeName: string,
  rejectionReason: string,
  storeSetupUrl: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your store application needs changes</title>
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
                Thank you for applying to sell on YIIVA. We've reviewed <strong>${storeName}</strong> and need a few changes before we can approve your store.
              </p>

              <!-- Rejection reason box -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
                <tr>
                  <td style="background-color:#f9f9f9;border-left:3px solid #0a0a0a;padding:16px 20px;border-radius:0 4px 4px 0;">
                    <p style="margin:0 0 6px 0;font-size:12px;font-weight:bold;color:#777777;text-transform:uppercase;letter-spacing:1px;">Feedback from our team</p>
                    <p style="margin:0;font-size:15px;color:#333333;line-height:1.7;">${rejectionReason}</p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 28px 0;font-size:16px;color:#333333;line-height:1.7;">
                Once you've made the changes, head back to your store setup and resubmit for review. We'd love to have you on YIIVA.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px 0;">
                <tr>
                  <td style="background-color:#0a0a0a;border-radius:4px;">
                    <a href="${storeSetupUrl}"
                       style="display:inline-block;padding:14px 36px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">
                      Update my store
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#777777;line-height:1.7;">
                If you have any questions about this feedback, reach out to us at
                <a href="mailto:support@yiiva.co.za" style="color:#333333;">support@yiiva.co.za</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 48px;border-top:1px solid #eeeeee;">
              <p style="margin:0;font-size:12px;color:#aaaaaa;text-align:center;">
                YIIVA — infrastructure for South Africa's creative brands.
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

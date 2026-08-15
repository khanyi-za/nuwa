export function verificationEmailTemplate(
  firstName: string,
  code: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verify your YIIVA account</title>
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
              <p style="margin:0 0 28px 0;font-size:16px;color:#333333;line-height:1.7;">
                Welcome to YIIVA. Enter this code to verify your email address and activate your account:
              </p>

              <!-- Code -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
                <tr>
                  <td align="center" style="background-color:#f5f5f5;border-radius:6px;padding:24px 0;">
                    <span style="font-size:36px;font-weight:bold;letter-spacing:12px;color:#0a0a0a;font-family:'Courier New',Courier,monospace;">${code}</span>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#777777;">This code expires in 10 minutes. Never share it with anyone — YIIVA will never ask you for it.</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 48px;border-top:1px solid #eeeeee;">
              <p style="margin:0;font-size:12px;color:#aaaaaa;text-align:center;">
                If you didn't create a YIIVA account, you can safely ignore this email.
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

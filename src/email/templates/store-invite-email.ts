export function storeInviteEmailTemplate(
  storeName: string,
  inviteUrl: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You've been invited to manage ${storeName} on YIIVA</title>
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
              <p style="margin:0 0 16px 0;font-size:16px;color:#111111;">Hi there,</p>
              <p style="margin:0 0 12px 0;font-size:16px;color:#333333;line-height:1.7;">
                You've been invited to help manage <strong>${storeName}</strong> on YIIVA, the marketplace for South African creative brands.
              </p>
              <p style="margin:0 0 28px 0;font-size:16px;color:#333333;line-height:1.7;">
                As a team member, you'll be able to manage products, edit the store profile, and help run the store from the merchant dashboard.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background-color:#0a0a0a;border-radius:4px;">
                    <a href="${inviteUrl}"
                       style="display:inline-block;padding:14px 36px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px 0;font-size:13px;color:#777777;line-height:1.7;">
                If the button above doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 28px 0;font-size:13px;color:#555555;word-break:break-all;">
                ${inviteUrl}
              </p>

              <p style="margin:0 0 8px 0;font-size:13px;color:#777777;">
                This invitation expires in 7 days.
              </p>
              <p style="margin:0;font-size:13px;color:#777777;">
                If you don't recognise this invitation, you can safely ignore this email.
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

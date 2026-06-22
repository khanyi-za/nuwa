/**
 * Transactional order emails for the Notifications module. One shared YIIVA
 * layout (dark header / white card / footer — matches verification-email.ts)
 * with a per-event builder. Money arrives as integer ZAR cents.
 */

function rand(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`;
}

function layout(opts: { heading: string; intro: string; orderNumber: string; rows: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${opts.heading}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background-color:#0a0a0a;padding:32px 48px;text-align:center;">
              <span style="font-size:26px;font-weight:bold;letter-spacing:6px;color:#ffffff;">YIIVA</span>
            </td>
          </tr>
          <tr>
            <td style="padding:48px;">
              <h1 style="margin:0 0 16px 0;font-size:22px;color:#0a0a0a;">${opts.heading}</h1>
              <p style="margin:0 0 24px 0;font-size:16px;color:#333333;line-height:1.7;">${opts.intro}</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8f8f8;border-radius:8px;padding:20px 24px;margin:0 0 24px 0;">
                <tr>
                  <td style="font-size:13px;color:#888888;padding-bottom:4px;">Order</td>
                </tr>
                <tr>
                  <td style="font-size:18px;font-weight:bold;color:#0a0a0a;padding-bottom:12px;">${opts.orderNumber}</td>
                </tr>
                ${opts.rows}
              </table>
              <p style="margin:0;font-size:14px;color:#555555;line-height:1.6;">Open the YIIVA app to view the full details and track your order.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 48px;border-top:1px solid #eeeeee;">
              <p style="margin:0;font-size:12px;color:#aaaaaa;text-align:center;">YIIVA — South Africa's marketplace for creative brands.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function totalRow(label: string, cents: number): string {
  return `<tr>
    <td style="font-size:15px;color:#333333;">${label}<span style="float:right;font-weight:bold;color:#0a0a0a;">${rand(cents)}</span></td>
  </tr>`;
}

export function orderConfirmedEmail(firstName: string, orderNumber: string, totalInCents: number): string {
  return layout({
    heading: 'Payment received',
    intro: `Hi ${firstName}, thanks for shopping on YIIVA. Your payment was successful and the merchant is preparing your order.`,
    orderNumber,
    rows: totalRow('Total paid', totalInCents),
  });
}

export function orderShippedEmail(firstName: string, orderNumber: string): string {
  return layout({
    heading: 'Your order is on the way',
    intro: `Hi ${firstName}, good news — your order has been handed to The Courier Guy and is on its way to you.`,
    orderNumber,
    rows: '',
  });
}

export function orderDeliveredEmail(firstName: string, orderNumber: string): string {
  return layout({
    heading: 'Your order has been delivered',
    intro: `Hi ${firstName}, your order has been delivered. We hope you love it. Tap into the app if anything isn't quite right.`,
    orderNumber,
    rows: '',
  });
}

export function orderCancelledEmail(firstName: string, orderNumber: string): string {
  return layout({
    heading: 'Your order was cancelled',
    intro: `Hi ${firstName}, your order has been cancelled. Any held stock has been released. If you didn't expect this, please contact support.`,
    orderNumber,
    rows: '',
  });
}

export function orderRefundedEmail(
  firstName: string,
  orderNumber: string,
  amountInCents: number,
  full: boolean,
): string {
  return layout({
    heading: full ? 'Your refund is being processed' : 'A partial refund is being processed',
    intro: `Hi ${firstName}, a refund for your order is being processed. It can take a few business days to reflect in your account.`,
    orderNumber,
    rows: totalRow('Refund amount', amountInCents),
  });
}

# OTP Email Deliverability

Use this checklist before relying on OTP signups in production.

## Best Setup

1. Use Brevo for sending transactional OTP emails.
2. Use an active sender email from Brevo, such as the active Gmail sender used by your other projects, or a custom sender email such as `no-reply@yourdomain.com`.
3. Keep `rota.salary.tracker@gmail.com` as the reply-to/support email.
4. If you use a custom domain, authenticate it in Brevo with DKIM and DMARC.
5. Check the admin page Email Delivery panel after every sender change.

Free sender domains such as `gmail.com`, `yahoo.com`, and `outlook.com` can be verified as Brevo senders, but they cannot be domain-authenticated in Brevo. That is why the Dividend-style Gmail sender can work, while a custom domain is still the stronger delivery setup.

## Brevo Steps

1. Open Brevo.
2. Go to `Settings > Senders, Domains, IPs > Domains`.
3. Add the domain you own, such as `yourdomain.com`.
4. Copy the DNS records Brevo gives you.
5. Add those DNS records at your domain provider.
6. Return to Brevo and click `Authenticate this email domain`.
7. Go to `Settings > Senders, Domains, IPs > Senders`.
8. Add a sender such as `Rota & Salary Tracker <no-reply@yourdomain.com>`, or use an already active sender in your Brevo account.
9. Make sure the sender is active. If using a custom domain, make sure the domain shows authenticated/verified.

## Vercel Environment Variables

After the sender is verified, update Vercel:

```text
BREVO_SENDER_EMAIL=your-active-brevo-sender@example.com
BREVO_SENDER_NAME=Rota & Salary Tracker
BREVO_REPLY_TO_EMAIL=rota.salary.tracker@gmail.com
OTP_FROM_EMAIL=Rota & Salary Tracker <no-reply@yourdomain.com>
OTP_REPLY_TO_EMAIL=rota.salary.tracker@gmail.com
```

Then redeploy production.

## Testing

1. Send OTPs to Gmail, Outlook/Hotmail, Yahoo, and iCloud test inboxes.
2. Check Inbox, Promotions, and Spam/Junk.
3. Check Brevo transactional logs for delivered, bounced, blocked, or spam complaint events.
4. In the admin page, unlock admin and run `Check OTP setup`.

No email provider can guarantee 100% inbox delivery, but a verified custom sender domain with DKIM and DMARC is the correct production setup.

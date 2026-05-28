# Rota & Salary Tracker

A static rota and salary tracking platform with:

- two-week rota pattern generation
- monthly gross pay estimates using the 15th payroll cutoff
- date status editing for work, off, training, overtime, annual leave, and bank holidays
- overtime target calculator
- sign in, sign up, sign out, and owner admin pages

## Deploy

This is a static site. Deploy the folder root to Vercel or GitHub Pages.

Suggested Vercel project name: `rota-salary-tracker`.

## OTP Email

Signup OTP uses Vercel serverless functions and supports Brevo or Resend.

For production delivery, use an active sender in Brevo for `BREVO_SENDER_EMAIL`.
That can be the same active Gmail sender pattern used by Dividend Stock Tracker,
or a verified custom domain sender for stronger deliverability. Keep
`rota.salary.tracker@gmail.com` as the reply-to/support address. See
[EMAIL_DELIVERABILITY.md](EMAIL_DELIVERABILITY.md).

Required Vercel environment variables:

- `OTP_SECRET`
- `BREVO_API_KEY` with `BREVO_SENDER_EMAIL`, or `RESEND_API_KEY`

Optional variables:

- `OTP_TTL_MINUTES`
- `OTP_FROM_EMAIL`
- `OTP_REPLY_TO_EMAIL`
- `BREVO_SENDER_NAME`
- `BREVO_REPLY_TO_EMAIL`

Default correspondence address: `rota.salary.tracker@gmail.com`.

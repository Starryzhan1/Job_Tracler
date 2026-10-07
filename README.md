# Job Application Tracker

Automates the emotional overhead of job hunting.

Scans your Gmail inbox daily, silently marks rejections as read so they don't pile up in your face, flags interview invites as unread so you only see what needs your attention, and sends a daily digest to your inbox.

Built because job hunting is a marathon — and resilience requires protecting your headspace, not just tracking your pipeline.

---

## What it does

- Scans **unread emails** from the last 24 hours only
- Detects **interview invites** in English + German → marks unread
- Detects **rejections** in English + German → marks read (silent cleanup)
- Flags **unclassified job emails** → marks unread (nothing slips through)
- Sends a **daily digest at 18:00** with stats: emails scanned, job-related found, interview invites, rejections, unclassified

## Tech stack

- **Next.js 16** (App Router, TypeScript)
- **Vercel Cron Jobs** — triggers daily at 18:00
- **Gmail IMAP** via imapflow
- **Nodemailer** — sends the HTML report via Gmail SMTP
- Deployed on **Vercel**

## Setup

### 1. Gmail App Password
1. Enable 2-Step Verification on your Google account
2. Go to [myaccount.google.com/security](https://myaccount.google.com/security) → App Passwords
3. Create one named `Job Tracker` — copy the 16-character password (remove spaces)

### 2. Environment variables

```bash
GMAIL_USER=your@gmail.com
GMAIL_APP_PASSWORD=your16charpassword
CRON_SECRET=generate_a_secret_with_openssl_rand_hex_32
```

Add these in Vercel → Settings → Environment Variables.

### 3. Deploy
Push to GitHub → import to Vercel → add environment variables → deploy.
The cron job auto-configures from `vercel.json`.

---

## Detection keywords

**Interview invites (EN):** `interview`, `schedule a call`, `next steps`, `we'd like to meet`, `phone screen`, `technical interview`, `coding challenge`, meeting links: Zoom, Teams, Google Meet, Calendly

**Interview invites (DE):** `Vorstellungsgespräch`, `Kennenlerngespräch`, `Telefoninterview`, `Videointerview`, `nächste Schritte`, `Probeaufgabe`, and more

**Rejections (EN):** `unfortunately`, `not selected`, `we regret to inform`, `moved forward with other candidates`, and more

**Rejections (DE):** `leider`, `Absage`, `nicht berücksichtigen`, `bedauern wir`, and more

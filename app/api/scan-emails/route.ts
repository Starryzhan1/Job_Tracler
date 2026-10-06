import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import Anthropic from "@anthropic-ai/sdk";
import nodemailer from "nodemailer";

const INTERVIEW_KEYWORDS = [
  "interview", "schedule a call", "next steps", "we'd like to meet",
  "phone screen", "technical interview", "coding challenge", "hiring manager",
  "zoom.us", "teams.microsoft.com", "meet.google.com", "calendly.com",
];

const REJECTION_KEYWORDS = [
  // English
  "unfortunately", "moved forward with other candidates", "not selected",
  "we regret to inform", "position has been filled", "decided not to move forward",
  "not moving forward", "we will not be", "thank you for your interest but",
  "other candidates whose experience", "we won't be moving",
  // German
  "leider", "absage", "haben wir uns für andere kandidaten entschieden",
  "nicht berücksichtigen", "nicht in die engere auswahl", "andere bewerber",
  "nicht weiterverfolgen", "bedauern wir", "kein passendes profil",
  "müssen wir ihnen mitteilen", "ihre bewerbung nicht berücksichtigen",
  "nicht den anforderungen", "haben wir uns für einen anderen kandidaten",
];

function detectType(subject: string, body: string): "interview" | "rejection" | "other" {
  const text = (subject + " " + body).toLowerCase();
  if (INTERVIEW_KEYWORDS.some((kw) => text.includes(kw))) return "interview";
  if (REJECTION_KEYWORDS.some((kw) => text.includes(kw))) return "rejection";
  return "other";
}

async function extractJobInfo(subject: string, body: string, from: string) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `Extract job info from this email. Reply with JSON only, no markdown.
From: ${from}
Subject: ${subject}
Body (first 500 chars): ${body.slice(0, 500)}

JSON format: {"company": "...", "position": "..."}
If not a job email, return {"company": "Unknown", "position": "Unknown"}`,
      },
    ],
  });
  try {
    const text = message.content[0].type === "text" ? message.content[0].text : "{}";
    return JSON.parse(text);
  } catch {
    return { company: "Unknown", position: "Unknown" };
  }
}

async function sendReportEmail(interviews: any[], rejections: any[], stats: { totalScanned: number; jobRelated: number }) {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  const formatRow = (item: any) =>
    `<tr>
      <td style="padding:8px;border:1px solid #ddd">${item.company}</td>
      <td style="padding:8px;border:1px solid #ddd">${item.position}</td>
      <td style="padding:8px;border:1px solid #ddd">${item.date}</td>
    </tr>`;

  const html = `
    <h2>Job Application Daily Report</h2>
    <p>Generated at 18:00 — ${new Date().toDateString()}</p>

    <table style="border-collapse:collapse;margin-bottom:24px;background:#f8fafc;width:100%">
      <tr>
        <td style="padding:12px 20px;text-align:center">
          <div style="font-size:28px;font-weight:bold">${stats.totalScanned}</div>
          <div style="color:#64748b;font-size:12px">Emails scanned</div>
        </td>
        <td style="padding:12px 20px;text-align:center;border-left:1px solid #e2e8f0">
          <div style="font-size:28px;font-weight:bold">${stats.jobRelated}</div>
          <div style="color:#64748b;font-size:12px">Job-related found</div>
        </td>
        <td style="padding:12px 20px;text-align:center;border-left:1px solid #e2e8f0">
          <div style="font-size:28px;font-weight:bold;color:#16a34a">${interviews.length}</div>
          <div style="color:#64748b;font-size:12px">Interview invites</div>
        </td>
        <td style="padding:12px 20px;text-align:center;border-left:1px solid #e2e8f0">
          <div style="font-size:28px;font-weight:bold;color:#dc2626">${rejections.length}</div>
          <div style="color:#64748b;font-size:12px">Rejections</div>
        </td>
        <td style="padding:12px 20px;text-align:center;border-left:1px solid #e2e8f0">
          <div style="font-size:28px;font-weight:bold;color:#d97706">${stats.jobRelated - interviews.length - rejections.length}</div>
          <div style="color:#64748b;font-size:12px">Unclassified</div>
        </td>
      </tr>
    </table>

    <h3 style="color:#16a34a">Interview Invites (${interviews.length})</h3>
    ${interviews.length > 0 ? `
    <table style="border-collapse:collapse;width:100%">
      <tr style="background:#f0fdf4">
        <th style="padding:8px;border:1px solid #ddd;text-align:left">Company</th>
        <th style="padding:8px;border:1px solid #ddd;text-align:left">Position</th>
        <th style="padding:8px;border:1px solid #ddd;text-align:left">Date</th>
      </tr>
      ${interviews.map(formatRow).join("")}
    </table>` : "<p>No interview invites today.</p>"}

    <h3 style="color:#dc2626">Rejections (${rejections.length})</h3>
    ${rejections.length > 0 ? `
    <table style="border-collapse:collapse;width:100%">
      <tr style="background:#fef2f2">
        <th style="padding:8px;border:1px solid #ddd;text-align:left">Company</th>
        <th style="padding:8px;border:1px solid #ddd;text-align:left">Position</th>
        <th style="padding:8px;border:1px solid #ddd;text-align:left">Date</th>
      </tr>
      ${rejections.map(formatRow).join("")}
    </table>` : "<p>No rejections today.</p>"}
  `;

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.GMAIL_USER,
    subject: `Job Tracker Report — ${new Date().toDateString()} | ${interviews.length} interview(s), ${rejections.length} rejection(s)`,
    html,
  });
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER!,
      pass: process.env.GMAIL_APP_PASSWORD!,
    },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    const interviews: any[] = [];
    const rejections: any[] = [];
    let jobRelated = 0;

    // Search emails from last 24 hours
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const uids = await client.search({ since });

    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), {
        envelope: true,
        bodyStructure: true,
        source: true,
      });

      const subject = msg.envelope?.subject || "";
      const from = msg.envelope?.from?.[0]?.address || "";
      const date = msg.envelope?.date
        ? new Date(msg.envelope.date).toLocaleDateString()
        : "";
      const source = msg.source?.toString() || "";

      // Skip non-job emails quickly before calling AI
      const quickCheck = (subject + " " + source).toLowerCase();
      const isJobRelated =
        ["application", "applied", "position", "role", "candidacy",
         "hiring", "interview", "offer", "bewerbung", "stelle"].some((kw) =>
          quickCheck.includes(kw)
        );
      if (!isJobRelated) continue;

      jobRelated++;
      const type = detectType(subject, source);
      if (type === "other") continue;

      const { company, position } = await extractJobInfo(subject, source.slice(0, 1000), from);
      const item = { company, position, date };

      if (type === "interview") {
        interviews.push(item);
        // Mark as UNREAD so it stands out
        await client.messageFlagsRemove(String(uid), ["\\Seen"]);
      } else {
        rejections.push(item);
        // Mark as READ to clean up inbox
        await client.messageFlagsAdd(String(uid), ["\\Seen"]);
      }
    }

    lock.release();
    await client.logout();

    const stats = { totalScanned: uids.length, jobRelated };
    await sendReportEmail(interviews, rejections, stats);

    return NextResponse.json({
      success: true,
      totalScanned: uids.length,
      jobRelated,
      interviews: interviews.length,
      rejections: rejections.length,
    });
  } catch (error: any) {
    console.error(error);
    await client.logout().catch(() => {});
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

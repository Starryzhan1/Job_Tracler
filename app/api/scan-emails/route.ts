import { NextResponse } from "next/server";
import { google } from "googleapis";
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

function getGmailClient() {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
  );
  auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth });
}

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

function decodeBody(payload: any): string {
  const getText = (parts: any[]): string => {
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64").toString("utf-8");
      }
      if (part.parts) {
        const found = getText(part.parts);
        if (found) return found;
      }
    }
    return "";
  };
  if (payload.body?.data) return Buffer.from(payload.body.data, "base64").toString("utf-8");
  if (payload.parts) return getText(payload.parts);
  return "";
}

async function sendReportEmail(interviews: any[], rejections: any[]) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: process.env.GMAIL_USER,
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
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

    <h3 style="color:#16a34a">🎉 Interview Invites (${interviews.length})</h3>
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

  try {
    const gmail = getGmailClient();

    // Search job-related emails from the last 24 hours
    const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const res = await gmail.users.messages.list({
      userId: "me",
      q: `(application OR interview OR offer OR position OR role OR candidacy OR hiring) after:${since}`,
      maxResults: 50,
    });

    const messages = res.data.messages || [];
    const interviews: any[] = [];
    const rejections: any[] = [];

    for (const msg of messages) {
      const full = await gmail.users.messages.get({ userId: "me", id: msg.id! });
      const headers = full.data.payload?.headers || [];
      const subject = headers.find((h) => h.name === "Subject")?.value || "";
      const from = headers.find((h) => h.name === "From")?.value || "";
      const date = headers.find((h) => h.name === "Date")?.value || "";
      const body = decodeBody(full.data.payload);

      const type = detectType(subject, body);
      if (type === "other") continue;

      const { company, position } = await extractJobInfo(subject, body, from);
      const item = { company, position, date: new Date(date).toLocaleDateString() };

      if (type === "interview") {
        interviews.push(item);
        // Mark as UNREAD so it stands out
        await gmail.users.messages.modify({
          userId: "me",
          id: msg.id!,
          requestBody: { addLabelIds: ["UNREAD"] },
        });
      } else {
        rejections.push(item);
        // Mark as READ to clean up inbox
        await gmail.users.messages.modify({
          userId: "me",
          id: msg.id!,
          requestBody: { removeLabelIds: ["UNREAD"] },
        });
      }
    }

    await sendReportEmail(interviews, rejections);

    return NextResponse.json({
      success: true,
      interviews: interviews.length,
      rejections: rejections.length,
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

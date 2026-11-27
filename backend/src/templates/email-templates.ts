const esc = (v: string) =>
  v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function layout(title: string, bodyHtml: string) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
<tr><td style="height:6px;background:#4f46e5;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px;"><h1 style="margin:0 0 12px;font-size:22px;">${esc(title)}</h1>${bodyHtml}</td></tr></table>
<p style="font-size:12px;color:#94a3b8;margin-top:16px;">Secure Examination Management System</p></td></tr></table></body></html>`;
}

export type EmailTemplate =
  | { template: "reset_password"; vars: { fullName: string; link: string } }
  | { template: "welcome_credentials"; vars: { fullName: string; email: string; tempPassword: string; loginUrl: string } };

export function renderEmail(t: EmailTemplate): { subject: string; html: string; text: string } {
  if (t.template === "reset_password") {
    const { fullName, link } = t.vars;
    return {
      subject: "Reset your password",
      text: `Hello ${fullName},\n\nUse this link within 30 minutes to reset your password:\n${link}\n\nIf you did not request this, ignore this email.`,
      html: layout(
        "Reset your password",
        `<p style="line-height:1.6;color:#475569;">Hello ${esc(fullName)}, use the button below within <strong>30 minutes</strong> to choose a new password.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;">Reset password</a></p>
<p style="font-size:13px;color:#94a3b8;">If you did not request this, you can safely ignore this email.</p>`,
      ),
    };
  }
  const { fullName, email, tempPassword, loginUrl } = t.vars;
  return {
    subject: "Your account has been created",
    text: `Hello ${fullName},\n\nAn account was created for you.\nEmail: ${email}\nTemporary password: ${tempPassword}\nSign in: ${loginUrl}\nYou must change this password at first sign-in.`,
    html: layout(
      "Your account is ready",
      `<p style="line-height:1.6;color:#475569;">Hello ${esc(fullName)}, an account has been created for you.</p>
<table role="presentation" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;width:100%;"><tr><td style="font-size:14px;line-height:1.8;">
<strong>Email:</strong> ${esc(email)}<br><strong>Temporary password:</strong> <code>${esc(tempPassword)}</code></td></tr></table>
<p><a href="${esc(loginUrl)}" style="color:#4f46e5;">Sign in</a> &mdash; you will be asked to change this password immediately.</p>`,
    ),
  };
}

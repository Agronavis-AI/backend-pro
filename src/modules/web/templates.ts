import { env } from '../../config/env';

/**
 * These are only ever rendered on a path that `webFormsEnabled` has already
 * gated, so the values are present by the time a template is built. The
 * fallbacks keep the types honest without pretending otherwise.
 */
const config = {
  get SITE_URL(): string {
    return env.SITE_URL ?? 'https://www.agronavis.in';
  },
  get CONTACT_TO(): string {
    return env.CONTACT_TO ?? '';
  },
};

const BRAND = '#0B3D2E';
const LEAF = '#7ED957';
const INK = '#16201b';
const MUTED = '#6f7a74';
const LINE = '#e4e8e5';
const PAGE = '#eef1ef';
const LOGO = `${config.SITE_URL}/logo.png`;

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

export function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' }[c]};`);
}

/** Inbox preview line. Hidden in the body, read by the mail client. */
const preheader = (text: string) =>
  `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">${escapeHtml(text)}</div>`;

const shell = (preview: string, inner: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"></head>
<body style="margin:0;padding:0;background:${PAGE};-webkit-font-smoothing:antialiased">
${preheader(preview)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE}">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${LINE}">
      ${inner}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
      <tr><td style="padding:18px 8px 0;font:400 11px/1.6 ${MONO};color:#9aa49e;text-align:center">
        AGRONAVIS &nbsp;·&nbsp; Intelligence for every field &nbsp;·&nbsp;
        <a href="${config.SITE_URL}" style="color:#9aa49e;text-decoration:underline">${host()}</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

const header = (badge: string) => `
<tr><td style="background:${BRAND};padding:22px 28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="vertical-align:middle">
      <img src="${LOGO}" width="30" height="30" alt=""
           style="display:inline-block;vertical-align:middle;border-radius:7px;border:0">
      <span style="display:inline-block;vertical-align:middle;padding-left:10px;font:700 16px/1 ${SANS};letter-spacing:-.01em;color:#ffffff">Agronavis</span>
    </td>
    <td align="right" style="vertical-align:middle;font:600 10px/1 ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${LEAF}">${escapeHtml(badge)}</td>
  </tr></table>
</td></tr>
<tr><td style="height:3px;background:${LEAF};font-size:0;line-height:0">&nbsp;</td></tr>`;

const host = () => config.SITE_URL.replace(/^https?:\/\//, '');

const stamp = () =>
  new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date());

export type Field = { label: string; value: string };

export function notificationEmail(o: {
  badge: string;
  heading: string;
  subheading: string;
  fields: Field[];
  message?: { label: string; body: string };
  replyTo?: string;
}): string {
  const rows = o.fields
    .filter((f) => f.value.trim())
    .map(
      (f) => `<tr>
        <td style="padding:11px 0;border-bottom:1px solid ${LINE};width:36%;vertical-align:top;font:600 11px/1.6 ${SANS};letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">${escapeHtml(f.label)}</td>
        <td style="padding:11px 0;border-bottom:1px solid ${LINE};vertical-align:top;font:400 15px/1.6 ${SANS};color:${INK}">${escapeHtml(f.value)}</td>
      </tr>`,
    )
    .join('');

  const quote = o.message?.body.trim()
    ? `<p style="margin:26px 0 10px;font:600 11px/1.6 ${SANS};letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">${escapeHtml(o.message.label)}</p>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
         <tr><td style="padding:16px 18px;background:#f5f8f6;border-left:3px solid ${LEAF};border-radius:0 6px 6px 0;font:400 15px/1.75 ${SANS};color:${INK};white-space:pre-wrap">${escapeHtml(o.message.body)}</td></tr>
       </table>`
    : '';

  const reply = o.replyTo
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px">
         <tr><td style="background:${BRAND};border-radius:999px">
           <a href="mailto:${escapeHtml(o.replyTo)}" style="display:inline-block;padding:12px 26px;font:600 14px/1 ${SANS};color:#ffffff;text-decoration:none">Reply to this person</a>
         </td></tr>
       </table>`
    : '';

  return shell(
    `${o.subheading} Received ${stamp()} IST.`,
    `${header(o.badge)}
     <tr><td style="padding:30px 28px 0">
       <h1 style="margin:0 0 6px;font:700 21px/1.3 ${SANS};letter-spacing:-.015em;color:${INK}">${escapeHtml(o.heading)}</h1>
       <p style="margin:0;font:400 15px/1.6 ${SANS};color:${MUTED}">${escapeHtml(o.subheading)}</p>
     </td></tr>
     <tr><td style="padding:22px 28px 0">
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
       ${quote}
       ${reply}
     </td></tr>
     <tr><td style="padding:24px 28px 26px">
       <div style="padding-top:16px;border-top:1px solid ${LINE};font:400 11px/1.7 ${MONO};color:#9aa49e">
         RECEIVED &nbsp;${stamp()} IST<br>SOURCE &nbsp;&nbsp;&nbsp;${host()} website form
       </div>
     </td></tr>`,
  );
}

export function autoReplyEmail(o: { name: string; line: string; next: string[] }): string {
  const first = o.name.trim().split(/\s+/)[0] || 'there';
  const steps = o.next
    .map(
      (t, i) => `<tr>
        <td style="width:26px;vertical-align:top;padding:0 0 12px;font:700 13px/1.7 ${MONO};color:${LEAF}">${String(i + 1).padStart(2, '0')}</td>
        <td style="vertical-align:top;padding:0 0 12px;font:400 15px/1.7 ${SANS};color:${INK}">${escapeHtml(t)}</td>
      </tr>`,
    )
    .join('');

  return shell(
    o.line,
    `${header('Confirmation')}
     <tr><td style="padding:30px 28px 0">
       <p style="margin:0 0 16px;font:400 16px/1.7 ${SANS};color:${INK}">Hi ${escapeHtml(first)},</p>
       <p style="margin:0 0 22px;font:400 16px/1.7 ${SANS};color:${INK}">${escapeHtml(o.line)}</p>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${steps}</table>
     </td></tr>
     <tr><td style="padding:14px 28px 28px">
       <div style="padding-top:18px;border-top:1px solid ${LINE}">
         <p style="margin:0 0 3px;font:600 15px/1.6 ${SANS};color:${INK}">The Agronavis team</p>
         <p style="margin:0;font:400 14px/1.6 ${SANS};color:${MUTED}">
           <a href="mailto:${config.CONTACT_TO}" style="color:${BRAND};text-decoration:none">${escapeHtml(config.CONTACT_TO)}</a>
         </p>
       </div>
     </td></tr>`,
  );
}

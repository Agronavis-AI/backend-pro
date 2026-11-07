import { Resend } from 'resend';
import { env } from '../../config/env';
import { autoReplyEmail, notificationEmail, type Field } from './templates';

/**
 * Built once, and only when there is a key.
 *
 * The farm API and the website share this process now, so a missing mail
 * provider must disable the forms rather than stop the service a phone in a
 * field depends on.
 */
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export const canSendMail = (): boolean => env.webFormsEnabled;

export type Submission = {
  subject: string;
  badge: string;
  heading: string;
  subheading: string;
  fields: Field[];
  message?: { label: string; body: string };
  replyTo?: string;
  autoReply?: { to: string; name: string; subject: string; line: string; next: string[] };
};

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string };

/**
 * Mailbox providers treat a missing unsubscribe path as a spam signal, even on
 * transactional mail. One-click unsubscribe is what Gmail and Yahoo look for.
 */
function listHeaders(): Record<string, string> {
  return {
    'List-Unsubscribe': `<mailto:${env.CONTACT_TO}?subject=unsubscribe>, <${env.SITE_URL}/unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

export async function sendSubmission(s: Submission): Promise<SendResult> {
  if (!resend || !env.CONTACT_TO || !env.CONTACT_FROM) {
    return { ok: false, error: 'mail is not configured' };
  }

  const { data, error } = await resend.emails.send({
    from: env.CONTACT_FROM,
    to: [env.CONTACT_TO],
    subject: s.subject,
    html: notificationEmail(s),
    headers: {
      // Groups a thread in the recipient's client rather than scattering it.
      'X-Entity-Ref-ID': `agronavis-${Date.now()}`,
    },
    ...(s.replyTo ? { replyTo: s.replyTo } : {}),
  });

  if (error) return { ok: false, error: error.message ?? 'Resend rejected the request' };

  // A failed confirmation must not fail the submission.
  if (env.SEND_AUTOREPLY && s.autoReply) {
    const a = s.autoReply;
    await resend.emails
      .send({
        from: env.CONTACT_FROM,
        to: [a.to],
        subject: a.subject,
        html: autoReplyEmail({ name: a.name, line: a.line, next: a.next }),
        replyTo: env.CONTACT_TO,
        headers: listHeaders(),
      })
      .catch(() => undefined);
  }

  return { ok: true, id: data?.id ?? null };
}

import type { Request, Response } from 'express';
import { z, ZodError, type ZodType } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { compressResume } from './compress';
import { sendSubmission, type Submission } from './email';
import { FALLBACK_OPENINGS } from './openings.fallback';
import {
  applicationSchema,
  contactSchema,
  deletionSchema,
  demoSchema,
  fieldErrors,
  newsletterSchema,
  topicLabels,
} from './web.schema';
import {
  listOpenings,
  saveApplication,
  saveDeletionRequest,
  type Resume,
} from './web.service';

/**
 * The website's forms: contact, demo, newsletter, careers and account
 * deletion. Public — no farmer signs in to use them.
 *
 * Every handler answers in the shape the website already renders:
 * `{ ok, error?, fields? }`, with per-field messages a form can place beside
 * the input that caused them.
 */

const MAIL_UNAVAILABLE = 'We could not send that just now.';

/** Where to tell someone to write when the machinery fails them. */
const fallbackContact = (): string => env.CONTACT_TO ?? 'contact@agronavis.in';

function badFields(res: Response, error: ZodError): void {
  res.status(400).json({
    ok: false,
    error: 'Some fields need another look.',
    fields: fieldErrors(error),
  });
}

/**
 * Bots fill in every field they can see, including the one no human is shown.
 * Answering 202 means they never learn the field is a trap.
 */
function caughtByHoneypot(route: string, value: string | undefined, res: Response): boolean {
  if (!value) return false;
  logger.info('Honeypot triggered', { route });
  res.status(202).json({ ok: true });
  return true;
}

function mailUnavailable(res: Response): void {
  res.status(503).json({
    ok: false,
    error: `${MAIL_UNAVAILABLE} Please email ${fallbackContact()} directly.`,
  });
}

/**
 * Contact, demo and newsletter differ only in their schema and their email.
 *
 * Generic over the schema rather than its shape, so each `build` receives the
 * schema's own parsed output — defaults applied, enums narrowed — instead of
 * a widened common type.
 */
async function submitForm<S extends ZodType<{ company_website?: string | undefined }>>(
  route: string,
  schema: S,
  build: (input: z.infer<S>) => Submission,
  req: Request,
  res: Response,
): Promise<void> {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return badFields(res, parsed.error);
  if (caughtByHoneypot(route, parsed.data.company_website, res)) return;
  if (!env.webFormsEnabled) return mailUnavailable(res);

  const result = await sendSubmission(build(parsed.data));
  if (!result.ok) {
    logger.error('Form not delivered', { route, error: result.error });
    res.status(502).json({
      ok: false,
      error: `${MAIL_UNAVAILABLE} Please email ${fallbackContact()} directly.`,
    });
    return;
  }

  logger.info('Form delivered', { route, id: result.id });
  res.json({ ok: true });
}

export const webController = {
  async openings(_req: Request, res: Response) {
    let openings = FALLBACK_OPENINGS;
    let source: 'database' | 'fallback' = 'fallback';

    try {
      const rows = await listOpenings();
      if (rows.length > 0) {
        openings = rows;
        source = 'database';
      }
    } catch (error) {
      // A careers page listing slightly stale roles beats one that will not
      // render at all.
      logger.warn('Openings lookup failed, serving the fallback list', {
        error: (error as Error).message,
      });
    }

    res
      .set('cache-control', 'public, max-age=300, stale-while-revalidate=3600')
      .json({ ok: true, source, openings });
  },

  contact: (req: Request, res: Response) =>
    submitForm('/contact', contactSchema, (i) => ({
      subject: `Consult request from ${i.name}`,
      badge: 'Consult',
      heading: 'New consult request',
      subheading: 'Someone asked to talk to an expert.',
      replyTo: i.email,
      fields: [
        { label: 'Name', value: i.name },
        { label: 'Email', value: i.email },
        { label: 'Phone', value: i.phone },
        { label: 'Topic', value: topicLabels[i.topic] },
      ],
      message: { label: 'What they said', body: i.message },
      autoReply: {
        to: i.email,
        name: i.name,
        subject: 'We got your message',
        line: 'Your question reached the Agronavis team and we are matching it to the right specialist.',
        next: [
          'A specialist reads your description and looks at recent satellite passes over your field.',
          'You get a reply with what we are seeing and what to do about it.',
          'If it needs a call, we send you a time that suits you.',
        ],
      },
    }), req, res),

  demo: (req: Request, res: Response) =>
    submitForm('/demo', demoSchema, (i) => ({
      subject: `Demo request: ${i.organisation}`,
      badge: 'Enterprise',
      heading: 'Enterprise demo request',
      subheading: `${i.organisation} wants to see the platform.`,
      replyTo: i.email,
      fields: [
        { label: 'Name', value: i.name },
        { label: 'Email', value: i.email },
        { label: 'Organisation', value: i.organisation },
        { label: 'Role', value: i.role },
        { label: 'Hectares', value: i.hectares },
      ],
      message: { label: 'Notes', body: i.message },
      autoReply: {
        to: i.email,
        name: i.name,
        subject: 'Your Agronavis demo request',
        line: 'Thanks for the demo request. Our enterprise team is putting a rollout plan together for you.',
        next: [
          'We map your regions and crops against current satellite coverage.',
          'You receive a rollout plan and indicative pricing within 48 hours.',
          'We walk you through the platform on a call, with your own acreage loaded.',
        ],
      },
    }), req, res),

  newsletter: (req: Request, res: Response) =>
    submitForm('/newsletter', newsletterSchema, (i) => ({
      subject: `Newsletter signup: ${i.email}`,
      badge: 'Field Notes',
      heading: 'Newsletter signup',
      subheading: 'Add this address to the Field Notes list.',
      replyTo: i.email,
      fields: [{ label: 'Email', value: i.email }],
      autoReply: {
        to: i.email,
        name: 'there',
        subject: 'You are on the Field Notes list',
        line: 'You are on the Field Notes list. We write when there is something worth reading, and unsubscribing takes one click.',
        next: [
          'Case studies from real farms, with the numbers those farms recorded.',
          'Field tips written in plain language, not agronomy jargon.',
          'Product notes, including the experiments that did not work.',
        ],
      },
    }), req, res),

  /**
   * A job application, with an optional CV.
   *
   * The stored row is the record of truth: if it cannot be written the
   * applicant is told, because losing an application silently is worse than
   * refusing it loudly. The email is best effort on top of that.
   */
  async apply(req: Request, res: Response) {
    const parsed = applicationSchema.safeParse(req.body);
    if (!parsed.success) return badFields(res, parsed.error);

    const input = parsed.data;
    if (caughtByHoneypot('/careers', input.company_website, res)) return;

    // "Something else" carries the applicant's own wording.
    const role = input.role_other?.trim() ? input.role_other.trim() : input.role;

    let resume: Resume | undefined;
    if (req.file) {
      const before = req.file.size;
      const out = await compressResume(req.file.buffer, req.file.mimetype);
      resume = {
        filename: out.extension
          ? `${req.file.originalname.replace(/\.[^.]+$/, '')}.${out.extension}`
          : req.file.originalname,
        mimeType: out.mimeType,
        bytes: out.bytes,
        originalBytes: before,
      };
      logger.info('Resume compressed', { before, after: out.bytes.length, note: out.note });
    }

    let stored: { id: string; resumeUrl: string | null } | null = null;
    try {
      stored = await saveApplication(
        {
          name: input.name,
          email: input.email,
          phone: input.phone,
          role,
          portfolio_url: input.portfolio_url,
          github_url: input.github_url,
          linkedin_url: input.linkedin_url,
          message: input.message,
        },
        resume,
      );
    } catch (error) {
      logger.error('Application not saved', { error: (error as Error).message });
      res.status(502).json({
        ok: false,
        error: `We could not record that. Please email ${fallbackContact()} with your CV attached.`,
      });
      return;
    }

    const links = [
      input.portfolio_url && { label: 'Portfolio', value: input.portfolio_url },
      input.github_url && { label: 'GitHub', value: input.github_url },
      input.linkedin_url && { label: 'LinkedIn', value: input.linkedin_url },
      resume && {
        label: 'Resume',
        value: stored.resumeUrl ?? `${resume.filename} (attached to the record)`,
      },
    ].filter(Boolean) as { label: string; value: string }[];

    if (env.webFormsEnabled) {
      const result = await sendSubmission({
        subject: `Application: ${role} - ${input.name}`,
        badge: 'Careers',
        heading: 'New application',
        subheading: `${input.name} applied for ${role}.`,
        replyTo: input.email,
        fields: [
          { label: 'Name', value: input.name },
          { label: 'Email', value: input.email },
          { label: 'Phone', value: input.phone ?? '' },
          { label: 'Role', value: role },
          ...links,
        ],
        message: { label: 'Their answer', body: input.message },
        autoReply: {
          to: input.email,
          name: input.name,
          subject: `Your application for ${role}`,
          line: `We have your application for ${role}, and it is in the pile we actually read.`,
          next: [
            'A member of the team reads your application in full. No keyword filter.',
            'If there is a fit, we set up a thirty minute conversation about your work and ours.',
            'Either way you hear back from us.',
          ],
        },
      });
      if (!result.ok) logger.error('Application email failed', { id: stored.id, error: result.error });
    }

    logger.info('Application received', { id: stored.id });
    res.json({ ok: true });
  },

  /**
   * An account deletion request from someone who has already uninstalled.
   *
   * A dropped request here is a compliance failure, not a bug, so it is
   * recorded before anything else and the caller is told if that fails.
   */
  async requestDeletion(req: Request, res: Response) {
    const parsed = deletionSchema.safeParse(req.body);
    if (!parsed.success) return badFields(res, parsed.error);

    const input = parsed.data;
    if (caughtByHoneypot('/account-deletion', input.company_website, res)) return;

    let reference: string;
    try {
      reference = await saveDeletionRequest({
        email: input.email,
        name: input.name,
        scope: input.scope,
        reason: input.reason,
      });
    } catch (error) {
      logger.error('Deletion request not recorded', { error: (error as Error).message });
      res.status(502).json({
        ok: false,
        error: `We could not record that. Please email ${fallbackContact()} and we will action it by hand.`,
      });
      return;
    }

    if (env.webFormsEnabled) {
      const result = await sendSubmission({
        subject: `Account deletion request: ${input.email}`,
        badge: 'Deletion',
        heading: 'Account deletion request',
        subheading: 'Action within 30 days and reply to confirm.',
        replyTo: input.email,
        fields: [
          { label: 'Email', value: input.email },
          { label: 'Name', value: input.name ?? '' },
          { label: 'Request', value: SCOPE_LABEL[input.scope] },
          { label: 'Reference', value: reference },
        ],
        ...(input.reason ? { message: { label: 'Reason given', body: input.reason } } : {}),
        autoReply: {
          to: input.email,
          name: input.name ?? 'there',
          subject: 'We received your deletion request',
          line: 'We have your request to delete your Agronavis data, and it is logged.',
          next: [
            'We confirm the request belongs to the account holder.',
            'Your profile, farms and fields, scans and photographs, tasks, advisories and posts are removed.',
            'We write to confirm once it is done, within 30 days and usually sooner.',
          ],
        },
      });
      if (!result.ok) logger.error('Deletion email failed', { reference, error: result.error });
    }

    logger.warn('Deletion request received', { reference, scope: input.scope });
    res.json({ ok: true, reference });
  },
};

const SCOPE_LABEL = {
  account: 'Delete the whole account',
  data: 'Delete my data, keep the account',
} as const;

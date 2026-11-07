import { z } from 'zod';

export const listPostsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createPostSchema = z.object({
  title: z.string().trim().min(3).max(160),
  content: z.string().trim().min(1).max(5000),
  imageUrl: z.string().url().optional(),
  mediaType: z.enum(['image', 'video']).optional(),
});

export const voteSchema = z.object({
  direction: z.enum(['up', 'down']),
});

export const replySchema = z.object({
  content: z.string().trim().min(1).max(2000),
});

export const idParamSchema = z.object({ id: z.string().uuid() });
export const postParamSchema = z.object({ postId: z.string().uuid() });

/**
 * Why something was reported.
 *
 * A fixed list rather than free text: a queue of sentences is a queue nobody
 * sorts, and the reasons map to what actually gets posted on a farming feed.
 * The note is optional and is for the one case the list does not cover.
 */
export const reportSchema = z.object({
  reason: z.enum([
    'spam',
    'abuse',
    'misinformation',
    'off_topic',
    'impersonation',
    'other',
  ]),
  note: z.string().trim().max(500).optional(),
});

/**
 * The thing being reported. Validating the id here keeps a malformed one out
 * of Postgres, which answers an invalid uuid with a 500 rather than a 400.
 */
export const reportTargetSchema = z.object({
  type: z.enum(['post', 'reply']),
  id: z.string().uuid(),
});

import type {
  CommunityPost,
  CommunityPostRow,
  CommunityReply,
  CommunityReplyRow,
  PostAuthor,
} from '@agronavis/shared-types';
import { db } from '../../config/supabase';
import { logger } from '../../config/logger';
import { badRequest, forbidden, fromPostgrest, notFound } from '../../shared/errors';

/**
 * Author details are embedded with an explicit column list. PostgREST would
 * happily return `farmers(*)` here, which is how `two_factor_secret` and
 * `backup_codes` end up in a public feed — so the columns are named, always.
 */
type AuthorJoin = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  state: string | null;
  district: string | null;
} | null;

const POST_COLUMNS =
  'id, author_id, title, content, attached_image_url, media_type, upvotes, created_at, ' +
  'author:farmers!community_posts_author_id_fkey(id, full_name, avatar_url, state, district)';

const REPLY_COLUMNS =
  'id, post_id, author_id, reply_content, created_at, ' +
  'author:farmers!community_replies_author_id_fkey(id, full_name, avatar_url, state, district)';

function toAuthor(row: AuthorJoin): PostAuthor | null {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    state: row.state,
    district: row.district,
  };
}

function toPost(
  row: CommunityPostRow & { author: AuthorJoin },
  viewerId: string,
  replyCount: number,
): CommunityPost {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    imageUrl: row.attached_image_url,
    mediaType: row.media_type,
    upvotes: row.upvotes,
    replyCount,
    createdAt: row.created_at,
    author: toAuthor(row.author),
    isOwn: row.author_id === viewerId,
  };
}

function toReply(row: CommunityReplyRow & { author: AuthorJoin }, viewerId: string): CommunityReply {
  return {
    id: row.id,
    postId: row.post_id ?? '',
    content: row.reply_content,
    createdAt: row.created_at,
    author: toAuthor(row.author),
    isOwn: row.author_id === viewerId,
  };
}

export const communityService = {
  /** Everyone this farmer has blocked, whose words they should not see. */
  /**
   * Every farmer whose writing must not appear for this viewer.
   *
   * Blocking runs both ways. A one-directional block would hide the harasser
   * from the person being harassed while leaving that person's posts open for
   * the harasser to read and reply to — which is the half that matters least
   * to the one being harassed.
   */
  async hiddenAuthors(viewerId: string): Promise<string[]> {
    const { data, error } = await db
      .from('community_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`);

    if (error) {
      // A feed that fails to load is worse than one that briefly shows
      // someone, so this degrades rather than throws — and says so loudly.
      logger.warn('Could not read the block list', { viewerId, error: error.message });
      return [];
    }

    const rows = (data ?? []) as { blocker_id: string; blocked_id: string }[];
    // Whichever side of the row is not the viewer is the farmer to hide.
    const others = rows.map((r) => (r.blocker_id === viewerId ? r.blocked_id : r.blocker_id));
    return [...new Set(others)];
  },

  async listPosts(viewerId: string, limit = 30, offset = 0): Promise<CommunityPost[]> {
    const hidden = await this.hiddenAuthors(viewerId);

    let query = db
      .from('community_posts')
      .select(POST_COLUMNS)
      .order('created_at', { ascending: false });

    // Blocking has to work on the feed itself. Hiding posts only in the app
    // would leave them in the payload on the phone, which is not blocking, it
    // is concealment.
    if (hidden.length > 0) query = query.not('author_id', 'in', `(${hidden.join(',')})`);

    const { data, error } = await query.range(offset, offset + limit - 1);
    if (error) throw fromPostgrest(error, 'List posts');

    const posts = (data ?? []) as unknown as (CommunityPostRow & { author: AuthorJoin })[];
    if (posts.length === 0) return [];

    // One extra round trip for all reply counts, rather than N+1 per post.
    const { data: replies } = await db
      .from('community_replies')
      .select('post_id')
      .in('post_id', posts.map((p) => p.id));

    const counts = new Map<string, number>();
    for (const r of replies ?? []) {
      if (r.post_id) counts.set(r.post_id, (counts.get(r.post_id) ?? 0) + 1);
    }

    return posts.map((p) => toPost(p, viewerId, counts.get(p.id) ?? 0));
  },

  async createPost(
    authorId: string,
    payload: { title: string; content: string; imageUrl?: string; mediaType?: 'image' | 'video' },
  ): Promise<CommunityPost> {
    const { data, error } = await db
      .from('community_posts')
      .insert({
        author_id: authorId,
        title: payload.title,
        content: payload.content,
        attached_image_url: payload.imageUrl ?? null,
        media_type: payload.mediaType ?? null,
      })
      .select(POST_COLUMNS)
      .single();
    if (error) throw fromPostgrest(error, 'Create post');
    return toPost(data as unknown as CommunityPostRow & { author: AuthorJoin }, authorId, 0);
  },

  async deletePost(authorId: string, postId: string): Promise<void> {
    const { data, error } = await db
      .from('community_posts')
      .delete()
      .eq('id', postId)
      .eq('author_id', authorId)
      .select('id')
      .maybeSingle();
    if (error) throw fromPostgrest(error, 'Delete post');
    if (!data) throw notFound('Post not found, or it is not yours to delete');
  },

  /** Upvote toggle. */
  async vote(postId: string, delta: 1 | -1): Promise<number> {
    const { data: current, error: readError } = await db
      .from('community_posts')
      .select('upvotes')
      .eq('id', postId)
      .maybeSingle();
    if (readError) throw fromPostgrest(readError, 'Load post');
    if (!current) throw notFound('Post not found');

    const next = Math.max(0, current.upvotes + delta);
    const { data, error } = await db
      .from('community_posts')
      .update({ upvotes: next })
      .eq('id', postId)
      .select('upvotes')
      .single();
    if (error) throw fromPostgrest(error, 'Update votes');
    return data.upvotes;
  },

  /**
   * Records a report. Silent to everyone but the person who filed it.
   *
   * The author is stored alongside, so a report still says who wrote the
   * thing after the thing itself has been deleted — which is exactly what
   * someone does when reported.
   */
  async report(
    reporterId: string,
    targetType: 'post' | 'reply',
    targetId: string,
    reason: string,
    note?: string,
  ): Promise<void> {
    const table = targetType === 'post' ? 'community_posts' : 'community_replies';
    const { data: target } = await db
      .from(table)
      .select('author_id')
      .eq('id', targetId)
      .maybeSingle();

    if (!target) throw notFound('That post is no longer here');

    const { error } = await db.from('content_reports').upsert(
      {
        reporter_id: reporterId,
        target_type: targetType,
        target_id: targetId,
        author_id: (target as { author_id: string | null }).author_id,
        reason,
        note: note ?? null,
      },
      { onConflict: 'reporter_id,target_type,target_id' },
    );
    if (error) throw fromPostgrest(error, 'Report content');

    logger.warn('Content reported', { targetType, targetId, reason });
  },

  /** Stops this farmer seeing another one, in both directions of the feed. */
  async block(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) throw badRequest('You cannot block yourself');

    const { error } = await db
      .from('community_blocks')
      .upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: 'blocker_id,blocked_id' });
    if (error) throw fromPostgrest(error, 'Block farmer');
  },

  /**
   * Who this farmer has blocked, with enough detail to recognise them.
   *
   * A block nobody can see is a block nobody can lift, so the profile needs
   * this list.
   */
  async listBlocked(blockerId: string): Promise<PostAuthor[]> {
    const { data, error } = await db
      .from('community_blocks')
      .select('created_at, blocked:farmers!community_blocks_blocked_id_fkey(id, full_name, avatar_url, state, district)')
      .eq('blocker_id', blockerId)
      .order('created_at', { ascending: false });

    if (error) throw fromPostgrest(error, 'List blocked farmers');

    return ((data ?? []) as unknown as { blocked: AuthorJoin }[])
      .map((r) => toAuthor(r.blocked))
      .filter((a): a is PostAuthor => a !== null);
  },

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    const { error } = await db
      .from('community_blocks')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId);
    if (error) throw fromPostgrest(error, 'Unblock farmer');
  },

  async listReplies(viewerId: string, postId: string): Promise<CommunityReply[]> {
    const hidden = await this.hiddenAuthors(viewerId);

    let query = db
      .from('community_replies')
      .select(REPLY_COLUMNS)
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    // A block that hid someone's posts but not their replies would leave
    // them talking to you underneath everyone else's.
    if (hidden.length > 0) query = query.not('author_id', 'in', `(${hidden.join(',')})`);

    const { data, error } = await query;
    if (error) throw fromPostgrest(error, 'List replies');
    return ((data ?? []) as unknown as (CommunityReplyRow & { author: AuthorJoin })[]).map((r) =>
      toReply(r, viewerId),
    );
  },

  async addReply(authorId: string, postId: string, content: string): Promise<CommunityReply> {
    const { data, error } = await db
      .from('community_replies')
      .insert({ post_id: postId, author_id: authorId, reply_content: content })
      .select(REPLY_COLUMNS)
      .single();
    if (error) throw fromPostgrest(error, 'Add reply');
    return toReply(data as unknown as CommunityReplyRow & { author: AuthorJoin }, authorId);
  },

  async deleteReply(authorId: string, replyId: string): Promise<void> {
    const { data, error } = await db
      .from('community_replies')
      .delete()
      .eq('id', replyId)
      .eq('author_id', authorId)
      .select('id')
      .maybeSingle();
    if (error) throw fromPostgrest(error, 'Delete reply');
    if (!data) throw forbidden('That reply is not yours to delete');
  },
};

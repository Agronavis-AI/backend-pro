import axios from 'axios';
import { ALERT_CATEGORIES } from './alert-categories';
import type { AlertCategory, AppNotification, Json, NotificationRow } from '@agronavis/shared-types';
import { readAlertPreferences } from '../farmers/farmers.service';
import { logger } from '../../config/logger';
import { db } from '../../config/supabase';
import { fromPostgrest, notFound } from '../../shared/errors';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** What the handset may report, and the words each one is recorded with. */
export const DEVICE_EVENTS = {
  sahayak_ready: {
    title: 'Sahayak is ready',
    body: 'The assistant finished downloading and now answers on your phone, with no connection needed.',
    type: 'sahayak',
  },
} as const;

export type DeviceEvent = keyof typeof DEVICE_EVENTS;

/** Short enough to be a real absence, long enough not to nag a daily user. */
const WELCOME_BACK_AFTER_DAYS = 3;

const isAlertCategory = (type: string): type is AlertCategory =>
  (ALERT_CATEGORIES as readonly string[]).includes(type);

function toNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    type: row.type,
    severity: row.severity ?? 'medium',
    data: row.data,
    read: row.read,
    createdAt: row.created_at,
  };
}

/**
 * Severities that are allowed to light up a handset.
 *
 * Everything is stored and everything shows in the app. This decides only what
 * interrupts someone — an app that buzzes for all of it gets its notifications
 * switched off, and the alert that mattered is lost along with the rest.
 */
const PUSH_SEVERITIES: ReadonlySet<string> = new Set(['critical', 'high']);

export const notificationsService = {
  async list(farmerId: string, limit = 30): Promise<AppNotification[]> {
    const { data, error } = await db
      .from('notifications')
      .select('*')
      .eq('farmer_id', farmerId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw fromPostgrest(error, 'List notifications');
    return (data ?? []).map((row) => toNotification(row as NotificationRow));
  },

  async unreadCount(farmerId: string): Promise<number> {
    const { count, error } = await db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('farmer_id', farmerId)
      .eq('read', false);
    if (error) throw fromPostgrest(error, 'Count notifications');
    return count ?? 0;
  },

  /**
   * `read` is a generated column — the database computes it from `read_at`
   * and refuses any write to it ("column \"read\" can only be updated to
   * DEFAULT"). Both of these marked `read` directly, so every attempt to read
   * an alert answered 500 and the badge never cleared.
   */
  async markRead(farmerId: string, id: string): Promise<AppNotification> {
    const { data, error } = await db
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('farmer_id', farmerId)
      .select('*')
      .maybeSingle();
    if (error) throw fromPostgrest(error, 'Update notification');
    if (!data) throw notFound('Notification not found');
    return toNotification(data as NotificationRow);
  },

  async markAllRead(farmerId: string): Promise<number> {
    const { data, error } = await db
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('farmer_id', farmerId)
      // Only the unread ones, so re-reading the screen does not keep moving
      // the timestamp on alerts that were read days ago.
      .is('read_at', null)
      .select('id');
    if (error) throw fromPostgrest(error, 'Update notifications');
    return (data ?? []).length;
  },

  /**
   * Stores a notification, then delivers it if its severity warrants one.
   *
   * Storing and delivering are separate decisions. Every alert is written to
   * Supabase so it is there to read in the app whatever happens next; only the
   * urgent ones are pushed. Before this they were the same decision, so a
   * medium advisory was never written at all and could not be read anywhere.
   *
   * Expo's push service is the single call that reaches both platforms — it
   * hands off to FCM on Android and APNs on iOS — so neither credential has to
   * live in this process. Delivery is best effort and its outcome is recorded
   * on the row rather than only logged: a push that silently failed is
   * indistinguishable from one that was never sent unless something writes it
   * down.
   */
  /**
   * A greeting on the way in: the first ever, or one after an absence.
   *
   * This used to hang off `registerPushToken`, which fires only once a handset
   * has a push token — and on a build with no FCM credentials no token is ever
   * issued, so the welcome never happened and the alerts list stayed empty for
   * everyone. The record a farmer reads in the app must not depend on whether
   * a push could be delivered.
   *
   * `lastSeenAt` lives in `profile_settings` so this needs no column of its
   * own. Returning sooner than the gap says nothing, so nothing is sent.
   */
  async greet(farmerId: string): Promise<void> {
    const { data: farmer } = await db
      .from('farmers')
      .select('full_name, profile_settings')
      .eq('id', farmerId)
      .maybeSingle();
    if (!farmer) return;

    const settings = ((farmer.profile_settings ?? {}) as Record<string, unknown>) ?? {};
    const lastSeen = typeof settings.lastSeenAt === 'string' ? Date.parse(settings.lastSeenAt) : NaN;
    const now = Date.now();

    // Stamped before the send, so a failure there cannot leave a farmer being
    // greeted on every single launch.
    await db
      .from('farmers')
      .update({ profile_settings: { ...settings, lastSeenAt: new Date(now).toISOString() } })
      .eq('id', farmerId);

    const name = String(farmer.full_name ?? '').trim().split(' ')[0];

    if (Number.isNaN(lastSeen)) {
      await this.send(farmerId, {
        title: name ? `Welcome to Agronavis, ${name}` : 'Welcome to Agronavis',
        body: 'Map a field and the alerts start here — when to irrigate, when disease weather is coming, and what is burning upwind.',
        type: 'welcome',
        severity: 'high',
        data: { welcome: true },
      });
      return;
    }

    const daysAway = Math.floor((now - lastSeen) / 86_400_000);
    if (daysAway < WELCOME_BACK_AFTER_DAYS) return;

    await this.send(farmerId, {
      title: name ? `Welcome back, ${name}` : 'Welcome back',
      body: `It has been ${daysAway} days. Your fields have been watched while you were away — open the app to see what changed.`,
      type: 'welcome',
      severity: 'medium',
      data: { welcomeBack: true, daysAway },
    });
  },

  /**
   * Records something that happened on the handset itself.
   *
   * The Sahayak download posts a local notification when it finishes, which
   * the farmer sees once and then cannot find again — it was the one message
   * the app showed that never reached the alerts list.
   *
   * The client names an event and nothing else. It does not get to choose the
   * words, so this cannot become a way to write arbitrary text into a farmer's
   * own alerts.
   */
  async recordDeviceEvent(farmerId: string, event: DeviceEvent): Promise<AppNotification | null> {
    const copy = DEVICE_EVENTS[event];

    // These are already on the screen in front of the farmer when they happen,
    // so there is nothing to push — only something to keep.
    return this.send(farmerId, { ...copy, severity: 'low' });
  },

  async send(
    farmerId: string,
    payload: {
      title: string;
      body: string;
      type?: string;
      severity?: AppNotification['severity'];
      data?: Record<string, unknown>;
    },
  ): Promise<AppNotification | null> {
    const severity = payload.severity ?? 'medium';

    const { data, error } = await db
      .from('notifications')
      .insert({
        farmer_id: farmerId,
        title: payload.title,
        body: payload.body,
        type: payload.type ?? 'general',
        severity,
        data: (payload.data ?? {}) as Json,
      })
      .select('*')
      .maybeSingle();

    if (error) {
      logger.warn('Notification not stored', { farmerId, error: error.message });
      return null;
    }

    const row = data as NotificationRow & { id: string };

    const settle = async (
      delivery: 'sent' | 'failed' | 'skipped',
      deliveryError?: string,
    ): Promise<void> => {
      await db
        .from('notifications')
        .update({
          delivery,
          delivered_at: delivery === 'sent' ? new Date().toISOString() : null,
          delivery_error: deliveryError ?? null,
        })
        .eq('id', row.id);
    };

    if (!PUSH_SEVERITIES.has(severity)) {
      await settle('skipped');
      return toNotification(row);
    }

    const { data: farmer } = await db
      .from('farmers')
      .select('expo_push_token, profile_settings')
      .eq('id', farmerId)
      .maybeSingle();

    // A muted category is still written to the alerts list — the farmer asked
    // not to be buzzed, not to be kept in the dark.
    const type = payload.type ?? 'general';
    if (isAlertCategory(type) && !readAlertPreferences(farmer?.profile_settings)[type]) {
      await settle('skipped', 'Muted by the farmer');
      return toNotification(row);
    }

    if (!farmer?.expo_push_token) {
      await settle('skipped', 'No device registered');
      return toNotification(row);
    }

    try {
      const response = await axios.post(
        EXPO_PUSH_ENDPOINT,
        {
          to: farmer.expo_push_token,
          title: payload.title,
          body: payload.body,
          data: { ...(payload.data ?? {}), notificationId: row.id },
          sound: 'default',
          priority: 'high',
          // Android 8 and later drop a notification with no channel. The app
          // creates this one on first launch; naming it here is what gets the
          // alert through with sound and a heads-up banner.
          channelId: 'default',
        },
        { timeout: 8_000, headers: { 'Content-Type': 'application/json' } },
      );

      // Expo answers 200 and then reports the real outcome inside the ticket.
      // Treating the status code as delivery recorded "sent" for every push
      // that was actually rejected — DeviceNotRegistered, a bad FCM key — so
      // the one table that could have revealed push was broken said it was
      // working.
      const ticket = (response.data as { data?: { status?: string; message?: string; details?: { error?: string } } })?.data;
      if (ticket?.status === 'error') {
        const reason = ticket.details?.error ?? ticket.message ?? 'Rejected by Expo';
        logger.warn('Expo push rejected', { farmerId, reason });

        // The token is dead: stop sending to it rather than failing forever.
        if (ticket.details?.error === 'DeviceNotRegistered') {
          await db.from('farmers').update({ expo_push_token: null }).eq('id', farmerId);
        }
        await settle('failed', String(reason).slice(0, 500));
        return toNotification(row);
      }

      await settle('sent');
    } catch (pushError) {
      const message = (pushError as Error).message;
      logger.warn('Expo push delivery failed', { farmerId, error: message });
      await settle('failed', message.slice(0, 500));
    }

    return toNotification(row);
  },
};

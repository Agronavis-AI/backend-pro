import compression from 'compression';
import cors from 'cors';
import express, { type Application, type Request, type Response } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { globalLimiter } from './middleware/rate-limit.middleware';
import { firmsStatus } from './modules/fires/fires.service';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware';
import { requestContext } from './middleware/request-context.middleware';

import { advisoryRoutes } from './modules/advisory/advisory.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { communityRoutes } from './modules/community/community.routes';
import { cropRoutes } from './modules/crops/crops.routes';
import { fireRoutes } from './modules/fires/fires.routes';
import { sahayakRoutes } from './modules/sahayak/sahayak.routes';
import { satelliteRoutes } from './modules/satellite/satellite.routes';
import { farmerRoutes } from './modules/farmers/farmers.routes';
import { farmRoutes } from './modules/farms/farms.routes';
import { marketRoutes } from './modules/market/market.routes';
import { notificationRoutes } from './modules/notifications/notifications.routes';
import { soilRoutes } from './modules/soil/soil.routes';
import { storageRoutes } from './modules/storage/storage.routes';
import { taskRoutes } from './modules/tasks/tasks.routes';
import { weatherRoutes } from './modules/weather/weather.routes';
import { webRoutes } from './modules/web/web.routes';

export function createApp(): Application {
  const app = express();

  // Behind Render/Fly/Nginx the client IP arrives in X-Forwarded-For; the rate
  // limiter would otherwise bucket every request under the proxy's address.
  app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());

  app.use(
    cors({
      origin: (origin, callback) => {
        // No Origin header: a native app or a server-to-server call, not a browser.
        if (!origin) return callback(null, true);
        if (env.allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(requestContext);

  // The outer ceiling. Per-route tiers live beside each router; this one only
  // stops a single client flooding the process. See rate-limit.middleware.ts
  // for why the key is the farmer rather than the address.
  app.use(globalLimiter);

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'agronavis-api',
      version: process.env.npm_package_version ?? '1.2.0',
      /**
       * Which build this actually is. The package version barely moves, so a
       * deploy that had not gone out looked identical to one that had — and a
       * bug fixed in the repo but not yet on the server is indistinguishable
       * from one that was never fixed. Render sets this; it is absent locally.
       */
      commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'local',
      /**
       * Whether NASA FIRMS is answering this server. It reached the point of
       * timing out in production while working fine from a laptop, and
       * without this there was no way to tell from outside.
       */
      firms: firmsStatus,
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  const prefix = `/api/${env.API_VERSION}`;

  app.use(`${prefix}/auth`, authRoutes);
  app.use(`${prefix}/farmers`, farmerRoutes);
  app.use(`${prefix}/farms`, farmRoutes);
  app.use(`${prefix}/crops`, cropRoutes);
  app.use(`${prefix}/tasks`, taskRoutes);
  app.use(`${prefix}/soil`, soilRoutes);
  app.use(`${prefix}/advisory`, advisoryRoutes);
  app.use(`${prefix}/fires`, fireRoutes);
  app.use(`${prefix}/satellite`, satelliteRoutes);
  app.use(`${prefix}/weather`, weatherRoutes);
  app.use(`${prefix}/market`, marketRoutes);
  app.use(`${prefix}/community`, communityRoutes);
  app.use(`${prefix}/notifications`, notificationRoutes);
  app.use(`${prefix}/storage`, storageRoutes);
  app.use(`${prefix}/sahayak`, sahayakRoutes);

  /**
   * The website's forms, mounted twice on purpose.
   *
   * `/api/*` is what agronavis.in already calls, and the site and this service
   * deploy separately — the paths have to keep working through the switch.
   * `/api/v1/*` is where they belong alongside everything else.
   */
  app.use(`${prefix}/web`, webRoutes);
  app.use('/api', webRoutes);

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'Agronavis API',
      version: '1.2.0',
      base: prefix,
      health: '/health',
      modules: [
        'auth',
        'farmers',
        'farms',
        'crops',
        'tasks',
        'soil',
        'advisory',
        'fires',
        'satellite',
        'weather',
        'market',
        'community',
        'notifications',
        'storage',
        'sahayak',
      ],
    });
  });

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}

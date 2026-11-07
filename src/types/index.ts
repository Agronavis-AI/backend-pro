// The single contract shared by the API, the mobile app and (later) the
// enterprise web console.
//
//   database.types.ts  what the tables look like   (generated: npm run db:types)
//   api.types.ts       what the REST API returns   (hand-written, camelCase)

export * from './database.types';
export * from './api.types';

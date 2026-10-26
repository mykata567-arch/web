// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const wordbooks = sqliteTable('wordbooks', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(),
  state: text('state').notNull(), revision: integer('revision').notNull().default(1),
  inviteHash: text('invite_hash').notNull(), createdAt: text('created_at').notNull(),
}, table => [uniqueIndex('wordbooks_owner').on(table.ownerId), uniqueIndex('wordbooks_invite').on(table.inviteHash)]);
export const accessAttempts = sqliteTable('access_attempts', {
  key: text('key').primaryKey(), window: integer('window').notNull(), count: integer('count').notNull().default(0),
});

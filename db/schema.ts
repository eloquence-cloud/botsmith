import { AnyPgColumn, integer, jsonb, pgEnum, pgTable, serial, text, varchar, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const modelProviderEnum = pgEnum("model_provider", ["open_ai"]);

// Function to create common columns for ChatNode entities (Message and ContextMessage)
function chatNodeColumns() {
  return {
    // The 'sequence' column represents the position of the node within its chat or completion.
    // It is a unique zero-based number within the chat across messages and completions.
    sequence: integer("sequence").notNull(),

    // The 'path' column is an array of integers that represents the hierarchical path of a node within a chat.
    // Each element in the array corresponds to the `sequence` of an ancestor node, with the root node at the start of the array.
    // For example, a root node would have a path like [0], its first child might have [0, 1], and a grandchild might have [0, 1, 2].
    // This path allows for the reconstruction of the node hierarchy and ordering within a chat.
    path: integer("path").array().notNull(),

    content: text("content").notNull(),
    metadata: jsonb("metadata").notNull(),
    createdAt: timestamp("created_at").notNull(),
  };
}

export const chat = pgTable("chat", {
  chatId: serial("chat_id").primaryKey(),
  headMessageId: integer("head_message_id"),
  metadata: jsonb("metadata").notNull(),
  defaultModelProvider: modelProviderEnum("default_model_provider").notNull(),
  defaultModel: varchar("default_model").notNull(),
  createdAt: timestamp("created_at").notNull(),
});

export const message = pgTable("message", {
  messageId: serial("message_id").primaryKey(),
  chatId: integer("chat_id").references((): AnyPgColumn => chat.chatId).notNull(),
  originatingCompletionId: integer("originating_completion_id").references((): AnyPgColumn => completion.completionId),
  ...chatNodeColumns(),
}, (table) => {
  return {
    // Composite index for maintaining the order of messages within a chat
    chatSequenceIdx: uniqueIndex("chat_sequence_idx").on(table.chatId, table.sequence),
    // Index for querying messages by their originating completion
    originatingCompletionIdx: index("originating_completion_idx").on(table.originatingCompletionId),
    // Index for querying messages by path (useful for hierarchical queries)
    pathIdx: index("path_idx").on(table.path),
  };
});

export const completion = pgTable("completion", {
  completionId: serial("completion_id").primaryKey(),
  chatId: integer("chat_id").references(() => chat.chatId).notNull(),
  ...chatNodeColumns(),
  modelProvider: modelProviderEnum("model_provider").notNull(),
  model: varchar("model").notNull(),
  modelParameters: jsonb("model_parameters").notNull(),
});

export const contextMessage = pgTable("context_message", {
  contextMessageId: serial("context_message_id").primaryKey(),
  completionId: integer("completion_id").references((): AnyPgColumn => completion.completionId).notNull(),
  ...chatNodeColumns(),
}, (table) => {
  return {
    // Composite index for maintaining the order of context messages within a completion
    completionSequenceIdx: uniqueIndex("completion_sequence_idx").on(table.completionId, table.sequence),
  };
});

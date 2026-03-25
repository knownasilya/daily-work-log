import Database from '@tauri-apps/plugin-sql';

const DB_PATH = 'sqlite:daily-work-log.db';

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!dbInstance) {
    dbInstance = await Database.load(DB_PATH);
  }
  return dbInstance;
}

export interface WorkLogEntry {
  id: number;
  date: string;
  content: string;
  emoji_id: string | null;
  sort_order: number;
}

export interface EmojiRule {
  id: string;
  image: string;
  text: string;
  pattern: string;
  sort_order: number;
  label: string | null;
}

export async function getTasksForDate(date: string): Promise<WorkLogEntry[]> {
  const db = await getDb();
  const rows = await db.select<WorkLogEntry[]>(
    'SELECT * FROM work_log_entries WHERE date = $1 ORDER BY sort_order, id',
    [date]
  );
  return Array.isArray(rows) ? rows : [];
}

export async function addTask(
  date: string,
  content: string,
  emojiId?: string | null
): Promise<number> {
  const db = await getDb();
  const countResult = await db.select<[{ count: number }]>(
    'SELECT COUNT(*) as count FROM work_log_entries WHERE date = $1',
    [date]
  );
  const count = Array.isArray(countResult) ? countResult[0]?.count ?? 0 : 0;
  const sortOrder = typeof count === 'number' ? count : 0;

  const result = await db.execute(
    'INSERT INTO work_log_entries (date, content, emoji_id, sort_order) VALUES ($1, $2, $3, $4)',
    [date, content, emojiId ?? null, sortOrder]
  );
  return result.lastInsertId ?? 0;
}

export async function updateTask(
  id: number,
  updates: { content?: string; emoji_id?: string | null }
): Promise<void> {
  const db = await getDb();
  if (updates.content !== undefined) {
    await db.execute('UPDATE work_log_entries SET content = $1 WHERE id = $2', [
      updates.content,
      id,
    ]);
  }
  if (updates.emoji_id !== undefined) {
    await db.execute('UPDATE work_log_entries SET emoji_id = $1 WHERE id = $2', [
      updates.emoji_id,
      id,
    ]);
  }
}

export async function reorderTasksForDate(date: string, orderedIds: number[]): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.execute(
      'UPDATE work_log_entries SET sort_order = $1 WHERE id = $2 AND date = $3',
      [i, orderedIds[i], date]
    );
  }
}

export async function deleteTask(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM work_log_entries WHERE id = $1', [id]);
}

export async function setEntryEmoji(
  entryId: number,
  emojiId: string | null
): Promise<void> {
  await updateTask(entryId, { emoji_id: emojiId });
}

export async function getLastDay(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<[{ date: string }]>(
    'SELECT date FROM work_log_entries ORDER BY date DESC LIMIT 1'
  );
  if (Array.isArray(rows) && rows.length > 0) {
    return rows[0].date;
  }
  return null;
}

export async function getDistinctDates(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<[{ date: string }]>(
    'SELECT DISTINCT date FROM work_log_entries ORDER BY date DESC'
  );
  return Array.isArray(rows) ? rows.map((r) => r.date) : [];
}

export async function getDateTaskCount(date: string): Promise<number> {
  const db = await getDb();
  const result = await db.select<[{ count: number }]>(
    'SELECT COUNT(*) as count FROM work_log_entries WHERE date = $1',
    [date]
  );
  return Array.isArray(result) ? result[0]?.count ?? 0 : 0;
}

export async function getEmojiRules(): Promise<EmojiRule[]> {
  const db = await getDb();
  const rows = await db.select<EmojiRule[]>(
    'SELECT * FROM emoji_rules ORDER BY sort_order, id'
  );
  return Array.isArray(rows) ? rows : [];
}

/** Sets `sort_order` to 0..n-1 in list order (first id = highest auto-assign priority). */
export async function reorderEmojiRules(orderedIds: string[]): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.execute('UPDATE emoji_rules SET sort_order = $1 WHERE id = $2', [i, orderedIds[i]]);
  }
}

export async function upsertEmojiRule(rule: EmojiRule): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO emoji_rules (id, image, text, pattern, sort_order, label) VALUES ($1, $2, $3, $4, $5, $6)',
    [
      rule.id,
      rule.image,
      rule.text,
      rule.pattern,
      rule.sort_order,
      rule.label?.trim() ? rule.label.trim() : null,
    ]
  );
}

export async function deleteEmojiRule(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM emoji_rules WHERE id = $1', [id]);
  await db.execute('UPDATE work_log_entries SET emoji_id = NULL WHERE emoji_id = $1', [id]);
}

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
  pinned: boolean;
}

function sqlBoolean(v: unknown): boolean {
  return v === true || v === 1;
}

export interface EmojiRule {
  id: string;
  image: string;
  text: string;
  pattern: string;
  sort_order: number;
  label: string | null;
}

export interface Day {
  id: string;
  day: string;
  note: string | null;
  created_at: string;
}

export interface DayEntry {
  id: number;
  date: string;
  kind: 'focus' | 'upcoming';
  content: string;
  emoji_id: string | null;
  sort_order: number;
}

type AppSettingRow = { key: string; value: string };

export async function getAppSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<AppSettingRow[]>(
    'SELECT key, value FROM app_settings WHERE key = $1 LIMIT 1',
    [key]
  );
  if (Array.isArray(rows) && rows.length > 0) return rows[0].value;
  return null;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute('INSERT OR REPLACE INTO app_settings (key, value) VALUES ($1, $2)', [key, value]);
}

export async function getAlwaysOnTopSetting(): Promise<boolean> {
  const raw = await getAppSetting('always_on_top');
  if (!raw) return false;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export async function getUpcomingDefaultEmojiSetting(): Promise<string | null> {
  const raw = await getAppSetting('upcoming_default_emoji_id');
  return raw && raw.trim() ? raw : null;
}

export async function setUpcomingDefaultEmojiSetting(emojiId: string | null): Promise<void> {
  if (emojiId == null) {
    const db = await getDb();
    await db.execute('DELETE FROM app_settings WHERE key = $1', ['upcoming_default_emoji_id']);
    return;
  }
  await setAppSetting('upcoming_default_emoji_id', emojiId);
}

/** Latest `days.day` strictly before `day` (YYYY-MM-DD string order), or null. */
export async function getLatestDayBefore(day: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<[{ day: string }]>(
    'SELECT day FROM days WHERE day < $1 ORDER BY day DESC LIMIT 1',
    [day]
  );
  if (Array.isArray(rows) && rows.length > 0) return rows[0].day;
  return null;
}

/** Earliest `days.day` strictly after `day` (YYYY-MM-DD string order), or null. */
export async function getEarliestDayAfter(day: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<[{ day: string }]>(
    'SELECT day FROM days WHERE day > $1 ORDER BY day ASC LIMIT 1',
    [day]
  );
  if (Array.isArray(rows) && rows.length > 0) return rows[0].day;
  return null;
}

export async function ensureDay(day: string): Promise<Day> {
  const db = await getDb();
  const existing = await db.select<Day[]>('SELECT * FROM days WHERE day = $1 LIMIT 1', [day]);
  if (Array.isArray(existing) && existing.length > 0) return existing[0];

  const previousDay = await getLatestDayBefore(day);

  await db.execute('INSERT INTO days (id, day) VALUES ($1, $2)', [crypto.randomUUID(), day]);
  const created = await db.select<Day[]>('SELECT * FROM days WHERE day = $1 LIMIT 1', [day]);
  const dayRow = Array.isArray(created) && created.length > 0 ? created[0] : null;
  if (!dayRow) throw new Error(`Failed to ensure day row exists for ${day}`);

  try {
    if (previousDay) {
      await copyPinnedEntriesToNewDay(previousDay, day);
    }
  } catch {
    // ignore: carry-forward is best-effort
  }

  try {
    if (previousDay) {
      await seedFocusForNewDay(previousDay, day);
    }
  } catch {
    // ignore: carry-forward is best-effort
  }

  return dayRow;
}

export async function updateDayNote(day: string, note: string | null): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE days SET note = $1 WHERE day = $2', [note, day]);
}

export async function getTasksForDate(date: string): Promise<WorkLogEntry[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM work_log_entries WHERE date = $1 ORDER BY sort_order, id',
    [date]
  );
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    id: Number(r.id),
    date: String(r.date),
    content: String(r.content),
    emoji_id: r.emoji_id != null ? String(r.emoji_id) : null,
    sort_order: Number(r.sort_order),
    pinned: sqlBoolean(r.pinned),
  }));
}

async function copyPinnedEntriesToNewDay(sourceDate: string, targetDate: string): Promise<void> {
  const db = await getDb();
  const entries = await getTasksForDate(sourceDate);
  let sortOrder = 0;
  for (const e of entries) {
    if (!e.pinned) continue;
    await db.execute(
      'INSERT INTO work_log_entries (date, content, emoji_id, sort_order, pinned) VALUES ($1, $2, $3, $4, TRUE)',
      [targetDate, e.content, e.emoji_id, sortOrder]
    );
    sortOrder += 1;
  }
}

/**
 * Seeds the new day's focus list with:
 * 1. remaining (uncompleted) focus entries from the source day, at the top
 * 2. upcoming entries from the source day, after the carried-over focus
 */
async function seedFocusForNewDay(sourceDate: string, targetDate: string): Promise<void> {
  const db = await getDb();
  const focusRows = await db.select<Record<string, unknown>[]>(
    "SELECT content FROM day_entries WHERE date = $1 AND kind = 'focus' ORDER BY sort_order, id",
    [sourceDate]
  );
  const focus = Array.isArray(focusRows) ? focusRows : [];
  for (let i = 0; i < focus.length; i++) {
    await db.execute(
      "INSERT INTO day_entries (date, kind, content, sort_order) VALUES ($1, 'focus', $2, $3)",
      [targetDate, String(focus[i].content), i]
    );
  }

  const upcomingRows = await db.select<Record<string, unknown>[]>(
    "SELECT content FROM day_entries WHERE date = $1 AND kind = 'upcoming' ORDER BY sort_order, id",
    [sourceDate]
  );
  const upcoming = Array.isArray(upcomingRows) ? upcomingRows : [];
  for (let i = 0; i < upcoming.length; i++) {
    await db.execute(
      "INSERT INTO day_entries (date, kind, content, sort_order) VALUES ($1, 'focus', $2, $3)",
      [targetDate, String(upcoming[i].content), focus.length + i]
    );
  }
}

export async function addTask(
  date: string,
  content: string,
  emojiId?: string | null
): Promise<number> {
  await ensureDay(date);
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
  updates: { content?: string; emoji_id?: string | null; pinned?: boolean }
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
  if (updates.pinned !== undefined) {
    await db.execute('UPDATE work_log_entries SET pinned = $1 WHERE id = $2', [
      updates.pinned ? 1 : 0,
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

function mapDayEntryRow(r: Record<string, unknown>): DayEntry {
  return {
    id: Number(r.id),
    date: String(r.date),
    kind: r.kind === 'upcoming' ? 'upcoming' : 'focus',
    content: String(r.content),
    emoji_id: r.emoji_id != null ? String(r.emoji_id) : null,
    sort_order: Number(r.sort_order),
  };
}

export async function getDayEntries(
  date: string
): Promise<{ focus: DayEntry[]; upcoming: DayEntry[] }> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM day_entries WHERE date = $1 ORDER BY kind, sort_order, id',
    [date]
  );
  const all = Array.isArray(rows) ? rows.map(mapDayEntryRow) : [];
  return {
    focus: all.filter((e) => e.kind === 'focus'),
    upcoming: all.filter((e) => e.kind === 'upcoming'),
  };
}

export async function addDayEntry(
  date: string,
  kind: 'focus' | 'upcoming',
  content: string,
  emojiId?: string | null
): Promise<number> {
  await ensureDay(date);
  const db = await getDb();
  const countResult = await db.select<[{ count: number }]>(
    'SELECT COUNT(*) as count FROM day_entries WHERE date = $1 AND kind = $2',
    [date, kind]
  );
  const count = Array.isArray(countResult) ? countResult[0]?.count ?? 0 : 0;
  const sortOrder = typeof count === 'number' ? count : 0;

  let resolvedEmoji: string | null = null;
  if (kind === 'upcoming') {
    resolvedEmoji = emojiId !== undefined ? emojiId : await getUpcomingDefaultEmojiSetting();
  }

  const result = await db.execute(
    'INSERT INTO day_entries (date, kind, content, emoji_id, sort_order) VALUES ($1, $2, $3, $4, $5)',
    [date, kind, content, resolvedEmoji, sortOrder]
  );
  return result.lastInsertId ?? 0;
}

export async function updateDayEntryContent(id: number, content: string): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE day_entries SET content = $1 WHERE id = $2', [content, id]);
}

export async function updateDayEntryEmoji(id: number, emojiId: string | null): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE day_entries SET emoji_id = $1 WHERE id = $2 AND kind = 'upcoming'",
    [emojiId, id]
  );
}

export async function deleteDayEntry(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM day_entries WHERE id = $1', [id]);
}

export async function reorderDayEntries(
  date: string,
  kind: 'focus' | 'upcoming',
  orderedIds: number[]
): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.execute(
      'UPDATE day_entries SET sort_order = $1 WHERE id = $2 AND date = $3 AND kind = $4',
      [i, orderedIds[i], date, kind]
    );
  }
}

/** Insert a task for the focus entry's date, then delete the focus entry. */
export async function completeFocusEntry(entryId: number, emojiId: string | null): Promise<void> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM day_entries WHERE id = $1 AND kind = $2 LIMIT 1',
    [entryId, 'focus']
  );
  if (!Array.isArray(rows) || rows.length === 0) return;
  const entry = mapDayEntryRow(rows[0]);
  await addTask(entry.date, entry.content, emojiId);
  await deleteDayEntry(entryId);
}

/** Removes the day row, all work log entries, and all focus/upcoming entries for that calendar date. */
export async function deleteDay(day: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM work_log_entries WHERE date = $1', [day]);
  await db.execute('DELETE FROM day_entries WHERE date = $1', [day]);
  await db.execute('DELETE FROM days WHERE day = $1', [day]);
}

export async function setEntryEmoji(
  entryId: number,
  emojiId: string | null
): Promise<void> {
  await updateTask(entryId, { emoji_id: emojiId });
}

/** Latest calendar day among `days` rows (by `day` string), or null if none. */
export async function getLastDay(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<[{ day: string }]>(
    'SELECT day FROM days ORDER BY day DESC LIMIT 1'
  );
  if (Array.isArray(rows) && rows.length > 0) {
    return rows[0].day;
  }
  return null;
}

/** Day row plus task count for list views (history, etc.). */
export type DayWithTaskCount = Day & { task_count: number };

export async function getDays(): Promise<DayWithTaskCount[]> {
  const db = await getDb();
  const rows = await db.select<DayWithTaskCount[]>(
    `SELECT d.id, d.day, d.note, d.created_at,
       (SELECT COUNT(*) FROM work_log_entries w WHERE w.date = d.day) AS task_count
     FROM days d
     ORDER BY d.day DESC`
  );
  return Array.isArray(rows) ? rows : [];
}

/** Days whose note, any focus/upcoming entry, or any log entry content contains `query` (case-insensitive). */
export async function searchDaysByText(query: string): Promise<DayWithTaskCount[]> {
  const t = query.trim().toLowerCase();
  if (!t) return getDays();

  const db = await getDb();
  const rows = await db.select<DayWithTaskCount[]>(
    `SELECT d.id, d.day, d.note, d.created_at,
       (SELECT COUNT(*) FROM work_log_entries w WHERE w.date = d.day) AS task_count
     FROM days d
     WHERE instr(lower(coalesce(d.note, '')), $1) > 0
        OR EXISTS (
          SELECT 1 FROM work_log_entries w
          WHERE w.date = d.day AND instr(lower(w.content), $1) > 0
        )
        OR EXISTS (
          SELECT 1 FROM day_entries de
          WHERE de.date = d.day AND instr(lower(de.content), $1) > 0
        )
     ORDER BY d.day DESC`,
    [t]
  );
  return Array.isArray(rows) ? rows : [];
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

export interface WeekTotal {
  week: string;
  week_start: string;
  week_end: string;
  total_tasks: number;
}

export interface WeeklyEmojiRow {
  week: string;
  emoji_id: string;
  emoji_image: string;
  emoji_text: string;
  emoji_label: string;
  count: number;
}

export async function getWeeklyExcludedEmojisSetting(): Promise<string[]> {
  const raw = await getAppSetting('weekly_excluded_emojis');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function setWeeklyExcludedEmojisSetting(ids: string[]): Promise<void> {
  await setAppSetting('weekly_excluded_emojis', JSON.stringify(ids));
}

export async function getWeekTotals(): Promise<WeekTotal[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT strftime('%Y-%W', date) AS week,
            MIN(date) AS week_start,
            MAX(date) AS week_end,
            COUNT(*) AS total_tasks
     FROM work_log_entries
     GROUP BY strftime('%Y-%W', date)
     ORDER BY week DESC`
  );
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    week: String(r.week),
    week_start: String(r.week_start),
    week_end: String(r.week_end),
    total_tasks: Number(r.total_tasks),
  }));
}

export async function getWeeklyEmojiSummary(): Promise<WeeklyEmojiRow[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT strftime('%Y-%W', wle.date) AS week,
            er.id    AS emoji_id,
            er.image AS emoji_image,
            er.text  AS emoji_text,
            er.label AS emoji_label,
            COUNT(*) AS count
     FROM work_log_entries wle
     JOIN emoji_rules er ON wle.emoji_id = er.id
     WHERE er.label IS NOT NULL AND TRIM(er.label) != ''
     GROUP BY strftime('%Y-%W', wle.date), er.id
     ORDER BY week DESC, count DESC`
  );
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    week: String(r.week),
    emoji_id: String(r.emoji_id),
    emoji_image: String(r.emoji_image),
    emoji_text: String(r.emoji_text),
    emoji_label: String(r.emoji_label),
    count: Number(r.count),
  }));
}

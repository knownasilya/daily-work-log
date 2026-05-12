import { redirect } from '@sveltejs/kit';
import {
  ensureDay,
  getTasksForDate,
  getEmojiRules,
  getLastDay,
  getLatestDayBefore,
  getEarliestDayAfter,
  getDayEntries,
  getMentions,
} from '$lib/api/db';
import { toYYYYMMDD, isValidDateStr } from '$lib/utils';

export async function load({ params }: { params: { date: string } }) {
  const date = params.date;
  if (!isValidDateStr(date)) {
    redirect(302, `/day/${toYYYYMMDD(new Date())}`);
  }

  // ensureDay must finish before sibling queries: new days carry pinned tasks and upcoming->focus
  // entries inside ensureDay, and parallel reads would often resolve first with empty lists.
  const dayRow = await ensureDay(date);
  const [tasks, dayEntries, emojiRules, lastDay, prevDay, nextDay, mentions] = await Promise.all([
    getTasksForDate(date),
    getDayEntries(date),
    getEmojiRules(),
    getLastDay(),
    getLatestDayBefore(date),
    getEarliestDayAfter(date),
    getMentions(),
  ]);

  return {
    date,
    dayRow,
    tasks,
    focusEntries: dayEntries.focus,
    upcomingEntries: dayEntries.upcoming,
    emojiRules,
    mentions,
    isToday: date === toYYYYMMDD(new Date()),
    isLatestDay: lastDay !== null && date === lastDay,
    prevDay,
    nextDay,
  };
}

import { redirect } from '@sveltejs/kit';
import { ensureDay, getTasksForDate, getEmojiRules, getLastDay, getLatestDayBefore, getEarliestDayAfter } from '$lib/api/db';
import { toYYYYMMDD, isValidDateStr } from '$lib/utils';

export async function load({ params }: { params: { date: string } }) {
  const date = params.date;
  if (!isValidDateStr(date)) {
    redirect(302, `/day/${toYYYYMMDD(new Date())}`);
  }

  // ensureDay must finish before getTasksForDate: new days copy pinned entries inside ensureDay,
  // and parallel getTasksForDate would often resolve first with an empty list.
  const dayRow = await ensureDay(date);
  const [tasks, emojiRules, lastDay, prevDay, nextDay] = await Promise.all([
    getTasksForDate(date),
    getEmojiRules(),
    getLastDay(),
    getLatestDayBefore(date),
    getEarliestDayAfter(date),
  ]);

  return {
    date,
    dayRow,
    tasks,
    emojiRules,
    isToday: date === toYYYYMMDD(new Date()),
    isLatestDay: lastDay !== null && date === lastDay,
    prevDay,
    nextDay,
  };
}

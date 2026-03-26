import { redirect } from '@sveltejs/kit';
import { ensureDay, getTasksForDate, getEmojiRules, getLastDay } from '$lib/api/db';
import { toYYYYMMDD, isValidDateStr } from '$lib/utils';

export async function load({ params }) {
  const date = params.date;
  if (!isValidDateStr(date)) {
    redirect(302, `/day/${toYYYYMMDD(new Date())}`);
  }

  const [dayRow, tasks, emojiRules, lastDay] = await Promise.all([
    ensureDay(date),
    getTasksForDate(date),
    getEmojiRules(),
    getLastDay(),
  ]);

  return {
    date,
    dayRow,
    tasks,
    emojiRules,
    isToday: date === toYYYYMMDD(new Date()),
    isLatestDay: lastDay !== null && date === lastDay,
  };
}

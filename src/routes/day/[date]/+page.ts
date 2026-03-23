import { redirect } from '@sveltejs/kit';
import { getTasksForDate, getEmojiRules, getLastDay } from '$lib/api/db';
import { toYYYYMMDD, isValidDateStr } from '$lib/utils';

export async function load({ params }) {
  const date = params.date;
  if (!isValidDateStr(date)) {
    redirect(302, `/day/${toYYYYMMDD(new Date())}`);
  }

  const [tasks, emojiRules, lastDay] = await Promise.all([
    getTasksForDate(date),
    getEmojiRules(),
    getLastDay(),
  ]);

  return {
    date,
    tasks,
    emojiRules,
    isToday: date === toYYYYMMDD(new Date()),
    isLatestDay: lastDay !== null && date === lastDay,
  };
}

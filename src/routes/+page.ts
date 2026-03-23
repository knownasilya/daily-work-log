import { toYYYYMMDD } from '$lib/utils';

export function load() {
  return {
    today: toYYYYMMDD(new Date()),
  };
}

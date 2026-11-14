import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  return {
    user: locals.user,
    error: url.searchParams.get('error')
  };
};

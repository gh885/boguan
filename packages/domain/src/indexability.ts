export const MIN_POSTS_FOR_INDEX = 3;

export function isIndexableCollection(postCount: number): boolean {
  return postCount >= MIN_POSTS_FOR_INDEX;
}

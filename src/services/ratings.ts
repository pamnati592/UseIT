import { supabase } from './supabase';

// Single source for "has the signed-in user already rated this rental?".
//
// Used by RatingScreen to skip straight to the thank-you state, and by the two QR
// done screens to stop offering a rating at all once one exists — submit_rating
// rejects a second attempt, so offering the form again only leads to a dead end.
export async function hasRatedTransaction(transactionId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('ratings')
    .select('id')
    .eq('transaction_id', transactionId)
    .eq('reviewer_id', user.id)
    .maybeSingle();
  return !!data;
}

import Stripe from 'https://esm.sh/stripe@14?target=deno';

export type ChargeResult =
  | { ok: true; paymentIntentId: string }
  | { ok: false; error: string };

// Charges a saved card off-session (no customer present) for a post-payment
// amount owed after the fact — damage, a late-return fee. Requires the
// customer to already have a reusable payment method attached, which rentals
// now mandatorily save at checkout (setup_future_usage: 'off_session' in
// create-payment-intent, added 2026-08-16) — pre-existing transactions won't
// have one, so this fails cleanly with a message rather than a Stripe error
// bubbling up raw.
export async function chargeOffSession(
  stripe: Stripe,
  customerId: string,
  amountAgorot: number,
  description: string,
  metadata: Record<string, string>
): Promise<ChargeResult> {
  const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card' });
  const paymentMethod = methods.data[0];
  if (!paymentMethod) {
    return { ok: false, error: 'No saved payment method on file for this renter.' };
  }

  try {
    const intent = await stripe.paymentIntents.create({
      amount: amountAgorot,
      currency: 'ils',
      customer: customerId,
      payment_method: paymentMethod.id,
      off_session: true,
      confirm: true,
      description,
      metadata,
    });
    return { ok: true, paymentIntentId: intent.id };
  } catch (err: any) {
    return { ok: false, error: err.message ?? 'Charge failed' };
  }
}

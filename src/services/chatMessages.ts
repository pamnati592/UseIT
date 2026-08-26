import { supabase } from './supabase';
import { chatBus } from './chatBus';
import type { Database } from '../types/database';

/**
 * Posts a status-change system message and marks it read for whoever
 * triggered it, in one atomic conversations UPDATE. Used by any screen that
 * changes rental/purchase status (ChatRoomScreen's approve/pay/cancel/etc.,
 * QRScanScreen's handoff completion) — kept in one place so the read/badge
 * race those call sites were fixed for can't be reintroduced by a new caller
 * doing the update+read-mark as two separate steps.
 */
export async function insertSystemMessage(params: {
  conversationId: string;
  transactionId: string;
  userId: string;
  isLender: boolean;
  content: string;
  preview?: string;
}): Promise<void> {
  const { conversationId, transactionId, userId, isLender, content, preview } = params;
  const now = new Date().toISOString();
  const readField = isLender ? 'lender_last_read_at' : 'renter_last_read_at';

  const update: Pick<Database['public']['Tables']['conversations']['Update'], 'last_message' | 'last_message_at' | 'renter_last_read_at' | 'lender_last_read_at'> = {
    last_message: preview ?? content,
    last_message_at: now,
    [readField]: now,
  };
  await supabase.from('conversations').update(update).eq('id', conversationId);

  await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: userId,
    content,
    transaction_id: transactionId,
  });

  chatBus.notify();
}

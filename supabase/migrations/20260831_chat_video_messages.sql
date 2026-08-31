-- Extends chat media messages with a 'video' type, alongside the existing
-- 'image'/'audio' added for photo/voice messages. Same chat-media bucket and
-- RLS policies already cover it — those key off the conversation id in the
-- path, not the message type.
alter table public.messages
  drop constraint messages_message_type_check,
  add constraint messages_message_type_check
    check (message_type in ('text', 'image', 'audio', 'video'));

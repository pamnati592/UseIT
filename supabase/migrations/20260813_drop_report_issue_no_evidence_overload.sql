-- The 1-arg report_issue(p_tx) overload flipped a transaction to 'disputed'
-- without inserting any disputes row — a case could reach "under review" with
-- zero evidence for an admin to look at. Two call sites (ChatRoomScreen's
-- confirmDispute and QRDisplayScreen's reportIssue) used it instead of the
-- evidence-collecting 3-arg version; both were rewritten to route through
-- ChatRoomScreen's dispute modal, which now always calls report_issue with a
-- description and photo. Dropping the 1-arg overload so this omission can't
-- silently reappear — nothing in the app calls it anymore.
drop function if exists public.report_issue(uuid);

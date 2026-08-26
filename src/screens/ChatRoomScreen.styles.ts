import { StyleSheet } from 'react-native';
import type { ThemeColors } from '../theme/colors';

export const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { color: colors.text, fontSize: 22, fontWeight: '300' },
  itemAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  itemAvatarImg: { width: 36, height: 36, borderRadius: 18 },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 16, fontWeight: '600', color: colors.text },
  headerItemRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  headerItem: { fontSize: 12, color: colors.textFaint, flexShrink: 1 },
  calendarBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  calendarBtnText: { fontSize: 20 },

  messageList: { padding: 16, gap: 8 },
  bubbleWrapper: { marginVertical: 2, maxWidth: '80%' },
  bubbleWrapperMe: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleWrapperThem: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMe: { backgroundColor: colors.btn, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: colors.card, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTextMe: { color: colors.btnText },
  bubbleTextThem: { color: colors.text },
  bubbleTime: { fontSize: 11, marginTop: 3, color: colors.textFaint },
  bubbleTimeMe: { textAlign: 'right' },
  bubbleTimeThem: { textAlign: 'left' },

  // Rental request card — the live status board for one rental date range
  requestCard: {
    alignSelf: 'center', width: '92%', marginVertical: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 16, padding: 16, gap: 10,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  requestHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  requestHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  requestDateText: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  requestSubText: { color: colors.textMuted, fontSize: 13, marginTop: -6 },
  requestStatusRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  requestStatusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  requestStatusPillText: { fontSize: 12, fontWeight: '700' },
  requestStatus: { gap: 8, marginTop: 2, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  requestActions: { flexDirection: 'row', gap: 10 },
  viewProfileBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, marginTop: 2,
  },
  viewProfileText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  approveBtn: {
    flex: 1, height: 44, backgroundColor: colors.btn,
    borderRadius: 10, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
  },
  approveBtnText: { color: colors.btnText, fontWeight: '700', fontSize: 15 },
  rejectBtn: {
    flex: 1, height: 44,
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 10,
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
  },
  rejectBtnText: { color: colors.textSecondary, fontWeight: '600', fontSize: 15 },
  btnDisabled: { opacity: 0.4 },
  approvedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  handoffBlock: { gap: 10 },
  qrActionBtn: {
    height: 44, backgroundColor: colors.btn, borderRadius: 10,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
  },
  qrActionText: { color: colors.btnText, fontWeight: '700', fontSize: 15 },
  handoffSecondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusExpired: { color: colors.warning, fontWeight: '600', fontSize: 13 },
  // Plain-language caption shown for every rental status — what stage this is
  // and what (if anything) needs to happen next, role-aware.
  helperText: { fontSize: 13.5, color: colors.textSecondary, lineHeight: 19 },
  overdueText: { fontSize: 13.5, color: colors.danger, lineHeight: 19, fontWeight: '600' },
  helperTextFlex: { flex: 1 },
  messageSupportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: 8, paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 8, borderWidth: 1, borderColor: colors.primary,
  },
  messageSupportBtnText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  payBtn: {
    height: 44, backgroundColor: colors.btn, borderRadius: 10,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    width: '100%',
  },
  payBtnText: { color: colors.btnText, fontWeight: '700', fontSize: 15 },
  requestTime: { color: colors.textFaint, fontSize: 11, textAlign: 'right' },
  cancelRentalBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: colors.dangerBg, borderRadius: 8, borderWidth: 1, borderColor: colors.danger,
  },
  cancelRentalBtnText: { color: colors.danger, fontSize: 12, fontWeight: '700' },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg,
  },
  input: {
    flex: 1, minHeight: 44, maxHeight: 120,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10,
    color: colors.text, fontSize: 15,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.btn, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.card },
  sendBtnText: { fontSize: 20, color: colors.btnText, fontWeight: '600', marginTop: -2 },

  tabBar: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.btn },
  tabText: { fontSize: 14, color: colors.textFaint, fontWeight: '500' },
  tabTextActive: { color: colors.text, fontWeight: '600' },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabBadge: {
    backgroundColor: colors.warning, borderRadius: 10,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: { color: colors.btnText, fontSize: 10, fontWeight: '800' },

  emptyTab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  emptyTabText: { color: colors.textFaint, fontSize: 15 },

  // Meeting Point button
  meetingBtn: {
    height: 40, borderRadius: 10,
    borderWidth: 1, borderColor: colors.primary,
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
  },
  meetingBtnText: { color: colors.primary, fontWeight: '600', fontSize: 14 },

  // Dispute Modal
  modalOverlay: {
    flex: 1, backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12,
    gap: 14,
  },
  modalHandle: {
    alignSelf: 'center', width: 40, height: 4,
    borderRadius: 2, backgroundColor: colors.border, marginBottom: 6,
  },
  modalIconRow: { alignItems: 'center' },
  modalIconCircle: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  modalBody: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  arbitrationBox: {
    backgroundColor: colors.dangerBg, borderRadius: 12,
    borderLeftWidth: 3, borderLeftColor: colors.danger,
    padding: 14,
  },
  arbitrationText: { fontSize: 13, color: colors.text, lineHeight: 20, fontStyle: 'italic' },
  disputePreview: { width: '100%', height: 160, borderRadius: 12 },
  disputeCameraTile: {
    height: 120, borderRadius: 12,
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  cameraTileText: { color: colors.textMuted, fontSize: 14, fontWeight: '500' },
  disputeInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, minHeight: 72, textAlignVertical: 'top',
  },
  modalPrimaryBtn: {
    height: 52, backgroundColor: colors.btn, borderRadius: 14,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
  },
  modalPrimaryBtnText: { color: colors.btnText, fontSize: 15, fontWeight: '700' },
  modalOutlineBtn: {
    height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.primary,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
  },
  modalOutlineBtnText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  modalSecondaryBtn: { alignItems: 'center', paddingVertical: 8 },
  modalSecondaryBtnText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  modalCancelLink: { alignItems: 'center', paddingVertical: 4 },
  modalCancelLinkText: { color: colors.textFaint, fontSize: 14 },
  declineInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, minHeight: 72, textAlignVertical: 'top',
  },
  declineHint: { fontSize: 12, color: colors.textFaint, textAlign: 'center', marginTop: -6 },

  highlighted: {
    borderColor: colors.primary,
    borderWidth: 2,
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
});

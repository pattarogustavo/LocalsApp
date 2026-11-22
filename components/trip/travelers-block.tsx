import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripsStore } from '@/store/trips';
import { useAuthStore } from '@/store/auth';
import { generateId, getInitials } from '@/utils/trip-helpers';
import type { Traveler } from '@/types/voyage';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { trpc } from '@/lib/trpc';
import type { TripPermissions } from '@/hooks/use-trip-permissions';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

interface TravelersBlockProps {
  tripId: string;
  travelers: Traveler[];
  permissions: TripPermissions;
}

// Fixed palette of avatar colors assigned to travelers (pure data, not theme —
// each traveler is pinned to one of these regardless of light/dark scheme).
const AVATAR_COLORS = [
  '#4CAF7D', '#5B9BD5', '#E8A838', '#E85D5D', '#9B59B6',
  '#1ABC9C', '#E67E22', '#3498DB', '#E91E63', '#00BCD4',
];

/**
 * Add-a-traveler FORM: name + optional email invite (with role picker) —
 * just the content, no Modal/overlay chrome of its own, so a caller that
 * already has its own modal open can embed this directly instead of
 * stacking a second native Modal on top of it. iOS in particular can fail
 * to present a Modal rendered on top of another already-open Modal (a
 * silent failure — the new one just never appears), which is exactly what
 * happened when the expense modal tried to open this as its own nested
 * AddTravelerModal.
 */
export function AddTravelerForm({
  tripId,
  travelers,
  onDone,
  onInviteSent,
}: {
  tripId: string;
  travelers: Traveler[];
  /** Called when this sub-flow is finished — either cancelled or after a successful add. The caller decides what that means (close its own modal, or just switch back to its previous content). */
  onDone: () => void;
  /** Called after a successful email invite (never for a name-only add) — lets a caller that tracks invite status (e.g. TravelersBlock's own pending-badge list) refresh it. */
  onInviteSent?: () => void;
}) {
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const addTraveler = useTripsStore((s) => s.addTraveler);
  const getTripById = useTripsStore((s) => s.getTripById);
  const userEmail = useAuthStore((s) => s.user?.email);

  const [nameInput, setNameInput] = useState('');
  const [identifierInput, setIdentifierInput] = useState('');
  const [debouncedIdentifier, setDebouncedIdentifier] = useState('');
  const [selectedUser, setSelectedUser] = useState<{ id: number; username: string | null; name: string | null } | null>(null);
  const [roleInput, setRoleInput] = useState<'viewer' | 'editor'>('viewer');
  const [sending, setSending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inviteMutation = trpc.sharing.invite.useMutation();
  const upsertTripMutation = trpc.cloudTrips.upsert.useMutation();

  const trimmedIdentifier = identifierInput.trim();
  const searchQuery = trpc.user.search.useQuery(
    { query: debouncedIdentifier },
    { enabled: debouncedIdentifier.length >= 3 }
  );
  const searchResults = useMemo(() => searchQuery.data?.results ?? [], [searchQuery.data]);

  const handleIdentifierChange = (text: string) => {
    setIdentifierInput(text);
    setSelectedUser(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedIdentifier(text.trim()), 400);
  };

  // A single result whose identity exactly matches what was typed (the only
  // case for an email search, and the common case for a fully-typed
  // username) auto-confirms — no extra tap needed.
  useEffect(() => {
    if (selectedUser || searchResults.length !== 1) return;
    const only = searchResults[0];
    if (trimmedIdentifier.includes('@') || only.username?.toLowerCase() === trimmedIdentifier.toLowerCase()) {
      setSelectedUser(only);
    }
  }, [searchResults, trimmedIdentifier, selectedUser]);

  const handleSelectResult = (u: { id: number; username: string | null; name: string | null }) => {
    setSelectedUser(u);
    setIdentifierInput(u.username ?? identifierInput);
    setDebouncedIdentifier(u.username ?? debouncedIdentifier);
  };

  const searched = debouncedIdentifier.length >= 3 && debouncedIdentifier === trimmedIdentifier;
  const notFound = searched && !searchQuery.isFetching && !selectedUser && searchResults.length === 0;
  // A picker is only useful for a partial username match against several
  // accounts — an email search is always 0-or-1, and once one is selected
  // there's nothing left to pick from.
  const showPicker = searched && !searchQuery.isFetching && !selectedUser && searchResults.length > 0 && !trimmedIdentifier.includes('@');

  const handleAdd = async () => {
    const name = nameInput.trim();
    if (!name) return;

    if (!trimmedIdentifier) {
      const color = AVATAR_COLORS[travelers.length % AVATAR_COLORS.length];
      const traveler: Traveler = {
        id: generateId(),
        name,
        initials: getInitials(name),
        color,
        isRegistered: false,
      };
      await addTraveler(tripId, traveler);
      setNameInput('');
      setIdentifierInput('');
      onDone();
      return;
    }

    if (!selectedUser) return; // button is disabled in this state — defensive no-op
    if (userEmail && trimmedIdentifier.toLowerCase() === userEmail.toLowerCase()) {
      Alert.alert(t.common.error, t.sharing.inviteError);
      return;
    }

    setSending(true);
    try {
      try {
        await inviteMutation.mutateAsync({ tripClientId: tripId, identifier: trimmedIdentifier, role: roleInput });
      } catch (err: any) {
        // The server only fails to find the trip when it was never pushed to
        // the cloud yet (e.g. just created offline). Push it once and retry,
        // instead of always paying for an upsert the server already has.
        if (!String(err?.message ?? '').includes('Trip not found')) throw err;
        const trip = getTripById(tripId);
        if (!trip) throw err;
        await upsertTripMutation.mutateAsync({ clientId: trip.id, data: JSON.stringify(trip) });
        await inviteMutation.mutateAsync({ tripClientId: tripId, identifier: trimmedIdentifier, role: roleInput });
      }

      const color = AVATAR_COLORS[travelers.length % AVATAR_COLORS.length];
      const traveler: Traveler = {
        id: generateId(),
        name,
        initials: getInitials(name),
        color,
        // Only kept when the OWNER typed the email themselves — never
        // looked up server-side for display, so this is never someone
        // else's address shown back without their own typing it.
        email: trimmedIdentifier.includes('@') ? trimmedIdentifier.toLowerCase() : undefined,
        username: selectedUser.username ?? undefined,
        userId: String(selectedUser.id),
        isRegistered: true,
        inviteStatus: 'pending',
      };
      await addTraveler(tripId, traveler);
      onInviteSent?.();

      setNameInput('');
      setIdentifierInput('');
      setSelectedUser(null);
      setRoleInput('viewer');
      onDone();

      Alert.alert(
        t.travelers.inviteSent ?? 'Convite enviado',
        `${t.travelers.inviteMsg ?? 'Um convite foi enviado para'} ${selectedUser.username ? '@' + selectedUser.username : trimmedIdentifier}.`,
        [{ text: t.common.ok }]
      );
    } catch (err: any) {
      Alert.alert(t.common.error, err?.message ?? t.sharing.inviteError);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <View style={styles.modalTitleRow}>
        <Text style={styles.modalTitle}>{t.travelers.addTraveler}</Text>
        <TouchableOpacity onPress={onDone}>
          <Ionicons name="close-circle" size={24} color={colors.muted} />
        </TouchableOpacity>
      </View>
      <Text style={styles.modalSubtitle}>
        {t.travelers.inviteHint ?? 'Se o viajante tiver uma conta no TheLocals, ele receberá o roteiro completo.'}
      </Text>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>{(t.travelers.name ?? 'NOME').toUpperCase()}</Text>
        <TextInput
          style={styles.input}
          placeholder={t.travelers.namePlaceholder}
          placeholderTextColor={colors.muted}
          value={nameInput}
          onChangeText={setNameInput}
          autoCapitalize="words"
          returnKeyType="next"
          autoFocus
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>{`${t.travelers.identifier.toUpperCase()} (${(t.common.optional ?? 'opcional').toUpperCase()})`}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder={t.travelers.identifierPlaceholder}
            placeholderTextColor={colors.muted}
            value={identifierInput}
            onChangeText={handleIdentifierChange}
            keyboardType="default"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleAdd}
          />
          {trimmedIdentifier.length >= 3 && (
            <View style={{ marginLeft: -36 }}>
              {searchQuery.isFetching ? (
                <ActivityIndicator size="small" color={colors.muted} />
              ) : selectedUser ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
              ) : notFound ? (
                <Ionicons name="close-circle" size={20} color={colors.error} />
              ) : null}
            </View>
          )}
        </View>

        {selectedUser ? (
          <View style={styles.matchRow}>
            <View style={[styles.matchAvatar, { backgroundColor: colors.primary }]}>
              <Text style={styles.matchAvatarText}>{getInitials(selectedUser.name || selectedUser.username || '?')}</Text>
            </View>
            <Text style={styles.matchText}>
              {selectedUser.username ? `@${selectedUser.username}` : selectedUser.name}
            </Text>
          </View>
        ) : notFound ? (
          <Text style={[styles.inputHint, { color: colors.error }]}>{t.travelers.userNotFound}</Text>
        ) : (
          <Text style={styles.inputHint}>{t.travelers.identifierHint}</Text>
        )}

        {showPicker && (
          <View style={styles.pickerBox}>
            {searchResults.map((u) => (
              <TouchableOpacity key={u.id} style={styles.pickerRow} onPress={() => handleSelectResult(u)}>
                <View style={[styles.matchAvatar, { backgroundColor: colors.primary }]}>
                  <Text style={styles.matchAvatarText}>{getInitials(u.name || u.username || '?')}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.matchText}>{u.username ? `@${u.username}` : u.name}</Text>
                  {u.username && u.name ? <Text style={styles.inputHint}>{u.name}</Text> : null}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {trimmedIdentifier.length > 0 && selectedUser && (
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>{(t.travelers.role ?? 'PAPEL').toUpperCase()}</Text>
          <View style={styles.roleRow}>
            <TouchableOpacity
              onPress={() => setRoleInput('viewer')}
              style={[
                styles.roleBtn,
                { borderColor: roleInput === 'viewer' ? colors.primary : colors.border },
                roleInput === 'viewer' && { backgroundColor: withAlpha(colors.primary, 0.1) },
              ]}
            >
              <Ionicons name="eye-outline" size={16} color={roleInput === 'viewer' ? colors.primary : colors.muted} />
              <Text style={[styles.roleBtnText, { color: roleInput === 'viewer' ? colors.primary : colors.muted }]}>
                {t.sharing.roleViewer}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setRoleInput('editor')}
              style={[
                styles.roleBtn,
                { borderColor: roleInput === 'editor' ? colors.primary : colors.border },
                roleInput === 'editor' && { backgroundColor: withAlpha(colors.primary, 0.1) },
              ]}
            >
              <Ionicons name="create-outline" size={16} color={roleInput === 'editor' ? colors.primary : colors.muted} />
              <Text style={[styles.roleBtnText, { color: roleInput === 'editor' ? colors.primary : colors.muted }]}>
                {t.sharing.roleEditor}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.inputHint}>
            {roleInput === 'editor' ? t.sharing.roleEditorDesc : t.sharing.roleViewerDesc}
          </Text>
        </View>
      )}

      <View style={styles.modalActions}>
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={() => { onDone(); setNameInput(''); setIdentifierInput(''); setDebouncedIdentifier(''); setSelectedUser(null); setRoleInput('viewer'); }}
        >
          <Text style={styles.cancelText}>{t.common.cancel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmBtn, (!nameInput.trim() || sending || (trimmedIdentifier.length > 0 && !selectedUser)) && styles.confirmBtnDisabled]}
          onPress={handleAdd}
          disabled={!nameInput.trim() || sending || (trimmedIdentifier.length > 0 && !selectedUser)}
          activeOpacity={0.7}
        >
          {sending ? (
            <ActivityIndicator color={colors.textOnPrimary} size="small" />
          ) : (
            <Text style={styles.confirmText}>{t.common.add}</Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  );
}

/**
 * Thin Modal wrapper around AddTravelerForm — what TravelersBlock (and any
 * other caller that does NOT already have its own modal open) uses. A
 * caller that's already inside its own open Modal should embed
 * AddTravelerForm directly instead (see the note on AddTravelerForm above).
 */
export function AddTravelerModal({
  tripId,
  travelers,
  visible,
  onClose,
  onInviteSent,
}: {
  tripId: string;
  travelers: Traveler[];
  visible: boolean;
  onClose: () => void;
  onInviteSent?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.modalHandle} />
            <AddTravelerForm tripId={tripId} travelers={travelers} onDone={onClose} onInviteSent={onInviteSent} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export function TravelersBlock({ tripId, travelers, permissions }: TravelersBlockProps) {
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const removeTraveler = useTripsStore((s) => s.removeTraveler);
  const canManage = permissions.canManageTravelers;

  const [showModal, setShowModal] = useState(false);

  const revokeMutation = trpc.sharing.revoke.useMutation();
  const updateRoleMutation = trpc.sharing.updateRole.useMutation();
  const sharesQuery = trpc.sharing.listSentByMe.useQuery(
    { tripClientId: tripId },
    { enabled: !!tripId && canManage }
  );

  const shareForTraveler = useCallback((traveler: Traveler) => {
    const userId = traveler.userId ? Number(traveler.userId) : undefined;
    const email = traveler.email?.trim().toLowerCase();
    return sharesQuery.data?.find((s) => {
      if (s.status === 'revoked') return false;
      if (userId != null && s.inviteeUserId === userId) return true;
      return !!email && s.inviteeEmail.toLowerCase() === email;
    });
  }, [sharesQuery.data]);

  const statusLabel = (status: string) => {
    if (status === 'accepted') return { label: t.sharing.acceptedStatus, color: colors.textAccent };
    if (status === 'declined') return { label: t.sharing.declinedStatus, color: colors.error };
    return { label: t.sharing.pendingStatus, color: colors.warning };
  };

  const roleLabel = (r: string) => (r === 'editor' ? t.sharing.roleEditor : t.sharing.roleViewer);

  const handleChangeRole = (share: NonNullable<ReturnType<typeof shareForTraveler>>) => {
    if (share.status === 'revoked' || share.status === 'declined') return;
    const nextRole = share.role === 'editor' ? 'viewer' : 'editor';
    Alert.alert(
      t.sharing.roleEditor + ' / ' + t.sharing.roleViewer,
      nextRole === 'editor' ? t.sharing.roleEditorDesc : t.sharing.roleViewerDesc,
      [
        { text: t.common.cancel, style: 'cancel' },
        {
          text: roleLabel(nextRole),
          onPress: async () => {
            try {
              await updateRoleMutation.mutateAsync({ shareId: share.shareId, role: nextRole });
              sharesQuery.refetch();
            } catch (err: any) {
              Alert.alert(t.common.error, err?.message ?? t.sharing.inviteError);
            }
          },
        },
      ]
    );
  };

  const handleRemove = (traveler: Traveler) => {
    const share = shareForTraveler(traveler);
    const identifierLabel = traveler.username ? `@${traveler.username}` : traveler.email;
    if (share && (share.status === 'pending' || share.status === 'accepted')) {
      Alert.alert(
        t.sharing.revokeConfirmTitle,
        `${t.sharing.revokeConfirmMsg} ${identifierLabel}${t.sharing.revokeConfirmMsg2}`,
        [
          { text: t.common.cancel, style: 'cancel' },
          {
            text: t.common.delete,
            style: 'destructive',
            onPress: async () => {
              try {
                await revokeMutation.mutateAsync({ shareId: share.shareId });
                await removeTraveler(tripId, traveler.id);
                sharesQuery.refetch();
              } catch (err: any) {
                Alert.alert(t.common.error, err?.message ?? t.sharing.revokeError);
              }
            },
          },
        ]
      );
      return;
    }

    Alert.alert(
      t.travelers.deleteTraveler,
      `${t.travelers.deleteConfirm} ${traveler.name}?`,
      [
        { text: t.common.cancel, style: 'cancel' },
        {
          text: t.common.delete,
          style: 'destructive',
          onPress: () => removeTraveler(tripId, traveler.id),
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="people-outline" size={16} color={colors.textAccent} />
          <Text style={styles.headerTitle}>{(t.travelers.title ?? 'VIAJANTES').toUpperCase()}</Text>
        </View>
        {canManage && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowModal(true)}>
            <Ionicons name="person-add-outline" size={14} color={colors.textAccent} />
            <Text style={styles.addBtnText}>{t.common.add}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Avatar row */}
      <View style={styles.avatarRow}>
        {/* "Me" avatar always first */}
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={[styles.avatarText, { color: colors.textOnPrimary }]}>{(t.travelers.you ?? 'EU').toUpperCase()}</Text>
        </View>

        {travelers.map((traveler) => {
          const share = shareForTraveler(traveler);
          const isPending = share ? share.status === 'pending' : traveler.inviteStatus === 'pending';
          return (
            <TouchableOpacity
              key={traveler.id}
              onLongPress={canManage ? () => handleRemove(traveler) : undefined}
              style={[styles.avatar, { backgroundColor: traveler.color || colors.primary }]}
            >
              <Text style={styles.avatarText}>{traveler.initials}</Text>
              {isPending && <View style={styles.pendingDot} />}
            </TouchableOpacity>
          );
        })}

        {canManage && (
          <TouchableOpacity style={styles.addAvatar} onPress={() => setShowModal(true)}>
            <Ionicons name="add" size={18} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Traveler list */}
      {travelers.length > 0 && (
        <View style={styles.travelerList}>
          {travelers.map((traveler) => {
            const share = shareForTraveler(traveler);
            const status = share
              ? statusLabel(share.status)
              : traveler.inviteStatus === 'pending'
                ? statusLabel('pending')
                : null;
            const role = share?.role;
            return (
              <View key={traveler.id} style={styles.travelerRow}>
                <View style={[styles.smallAvatar, { backgroundColor: traveler.color || colors.primary }]}>
                  <Text style={styles.smallAvatarText}>{traveler.initials}</Text>
                </View>
                <View style={styles.travelerInfo}>
                  <Text style={styles.travelerName}>{traveler.name}</Text>
                  {traveler.username ? (
                    <Text style={styles.travelerEmail}>{`@${traveler.username}`}</Text>
                  ) : traveler.email ? (
                    <Text style={styles.travelerEmail}>{traveler.email}</Text>
                  ) : null}
                </View>
                <View style={styles.travelerStatus}>
                  {role && (
                    canManage && share ? (
                      <TouchableOpacity onPress={() => handleChangeRole(share)}>
                        <Text style={[styles.roleTag, styles.roleTagEditable]}>{roleLabel(role)}</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.roleTag}>{roleLabel(role)}</Text>
                    )
                  )}
                  {status ? (
                    <View style={[styles.pendingBadge, { backgroundColor: withAlpha(status.color, 0.15) }]}>
                      <Text style={[styles.pendingText, { color: status.color }]}>{status.label}</Text>
                    </View>
                  ) : traveler.isRegistered ? (
                    <View style={styles.activeBadge}>
                      <Text style={styles.activeText}>{t.travelers.active ?? 'Ativo'}</Text>
                    </View>
                  ) : null}
                  {canManage && (
                    <TouchableOpacity onPress={() => handleRemove(traveler)} style={styles.removeBtn}>
                      <Ionicons name="close" size={14} color={colors.muted} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      <AddTravelerModal
        tripId={tripId}
        travelers={travelers}
        visible={showModal}
        onClose={() => setShowModal(false)}
        onInviteSent={() => sharesQuery.refetch()}
      />
    </View>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    color: colors.foreground,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: withAlpha(colors.primary, 0.15),
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  addBtnText: {
    color: colors.textAccent,
    fontSize: 12,
    fontWeight: '600',
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  // White initials sit on arbitrary, data-driven avatar background colors
  // (AVATAR_COLORS / traveler.color) — not a themed surface, so no token
  // applies here; white stays legible across every avatar color in both schemes.
  avatarText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  pendingDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.warning,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  addAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: withAlpha(colors.foreground, 0.06),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: withAlpha(colors.foreground, 0.12),
    borderStyle: 'dashed',
  },
  travelerList: {
    marginTop: 14,
    gap: 8,
  },
  travelerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  smallAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Same rationale as avatarText above — sits on data-driven avatar colors.
  smallAvatarText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  travelerInfo: {
    flex: 1,
  },
  travelerName: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '500',
  },
  travelerEmail: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 1,
  },
  travelerStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roleTag: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '600',
  },
  roleTagEditable: {
    textDecorationLine: 'underline',
  },
  pendingBadge: {
    backgroundColor: withAlpha(colors.warning, 0.15),
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pendingText: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: '600',
  },
  activeBadge: {
    backgroundColor: withAlpha(colors.primary, 0.15),
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activeText: {
    color: colors.textAccent,
    fontSize: 10,
    fontWeight: '600',
  },
  removeBtn: {
    padding: 4,
  },
  // Full-screen backdrop scrim behind the bottom sheet — universal UI
  // pattern, intentionally theme-independent.
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlayModal,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 14,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: withAlpha(colors.foreground, 0.2),
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 4,
  },
  modalTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    color: colors.foreground,
    fontSize: 20,
    fontWeight: '700',
    fontStyle: 'italic',
    fontFamily: 'serif',
  },
  modalSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  input: {
    backgroundColor: withAlpha(colors.foreground, 0.07),
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: colors.foreground,
    fontSize: 15,
    borderWidth: 1,
    borderColor: withAlpha(colors.foreground, 0.1),
  },
  inputHint: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  matchAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchAvatarText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  matchText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: '600',
  },
  pickerBox: {
    backgroundColor: withAlpha(colors.foreground, 0.05),
    borderRadius: 12,
    overflow: 'hidden',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  roleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  roleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  roleBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: withAlpha(colors.foreground, 0.07),
    alignItems: 'center',
  },
  cancelText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '500',
  },
  confirmBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.4,
  },
  confirmText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
});

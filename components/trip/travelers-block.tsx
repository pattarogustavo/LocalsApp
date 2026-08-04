import React, { useMemo, useState } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripsStore } from '@/store/trips';
import { generateId, getInitials } from '@/utils/trip-helpers';
import type { Traveler } from '@/types/voyage';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

interface TravelersBlockProps {
  tripId: string;
  travelers: Traveler[];
}

// Fixed palette of avatar colors assigned to travelers (pure data, not theme —
// each traveler is pinned to one of these regardless of light/dark scheme).
const AVATAR_COLORS = [
  '#4CAF7D', '#5B9BD5', '#E8A838', '#E85D5D', '#9B59B6',
  '#1ABC9C', '#E67E22', '#3498DB', '#E91E63', '#00BCD4',
];

export function TravelersBlock({ tripId, travelers }: TravelersBlockProps) {
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const addTraveler = useTripsStore((s) => s.addTraveler);
  const removeTraveler = useTripsStore((s) => s.removeTraveler);
  const insets = useSafeAreaInsets();

  const [showModal, setShowModal] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');

  const handleAdd = async () => {
    const name = nameInput.trim();
    if (!name) return;

    const color = AVATAR_COLORS[travelers.length % AVATAR_COLORS.length];
    const traveler: Traveler = {
      id: generateId(),
      name,
      initials: getInitials(name),
      color,
      email: emailInput.trim() || undefined,
      isRegistered: false,
      inviteStatus: emailInput.trim() ? 'pending' : undefined,
    };
    await addTraveler(tripId, traveler);
    setNameInput('');
    setEmailInput('');
    setShowModal(false);

    if (emailInput.trim()) {
      Alert.alert(
        t.travelers.inviteSent ?? 'Convite enviado',
        `${t.travelers.inviteMsg ?? 'Um convite foi enviado para'} ${emailInput.trim()}.`,
        [{ text: t.common.ok }]
      );
    }
  };

  const handleRemove = (traveler: Traveler) => {
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
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowModal(true)}>
          <Ionicons name="person-add-outline" size={14} color={colors.textAccent} />
          <Text style={styles.addBtnText}>{t.common.add}</Text>
        </TouchableOpacity>
      </View>

      {/* Avatar row */}
      <View style={styles.avatarRow}>
        {/* "Me" avatar always first */}
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={[styles.avatarText, { color: colors.textOnPrimary }]}>{(t.travelers.you ?? 'EU').toUpperCase()}</Text>
        </View>

        {travelers.map((traveler) => (
          <TouchableOpacity
            key={traveler.id}
            onLongPress={() => handleRemove(traveler)}
            style={[styles.avatar, { backgroundColor: traveler.color || colors.primary }]}
          >
            <Text style={styles.avatarText}>{traveler.initials}</Text>
            {traveler.inviteStatus === 'pending' && (
              <View style={styles.pendingDot} />
            )}
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={styles.addAvatar} onPress={() => setShowModal(true)}>
          <Ionicons name="add" size={18} color={colors.muted} />
        </TouchableOpacity>
      </View>

      {/* Traveler list */}
      {travelers.length > 0 && (
        <View style={styles.travelerList}>
          {travelers.map((traveler) => (
            <View key={traveler.id} style={styles.travelerRow}>
              <View style={[styles.smallAvatar, { backgroundColor: traveler.color || colors.primary }]}>
                <Text style={styles.smallAvatarText}>{traveler.initials}</Text>
              </View>
              <View style={styles.travelerInfo}>
                <Text style={styles.travelerName}>{traveler.name}</Text>
                {traveler.email ? (
                  <Text style={styles.travelerEmail}>{traveler.email}</Text>
                ) : null}
              </View>
              <View style={styles.travelerStatus}>
                {traveler.inviteStatus === 'pending' ? (
                  <View style={styles.pendingBadge}>
                    <Text style={styles.pendingText}>{t.travelers.pending ?? 'Pendente'}</Text>
                  </View>
                ) : traveler.isRegistered ? (
                  <View style={styles.activeBadge}>
                    <Text style={styles.activeText}>{t.travelers.active ?? 'Ativo'}</Text>
                  </View>
                ) : null}
                <TouchableOpacity onPress={() => handleRemove(traveler)} style={styles.removeBtn}>
                  <Ionicons name="close" size={14} color={colors.muted} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Add Traveler Modal */}
      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
              <View style={styles.modalHandle} />
              <View style={styles.modalTitleRow}>
                <Text style={styles.modalTitle}>{t.travelers.addTraveler}</Text>
                <TouchableOpacity onPress={() => setShowModal(false)}>
                  <Ionicons name="close-circle" size={24} color={colors.muted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalSubtitle}>
                {t.travelers.inviteHint ?? 'Se o viajante tiver uma conta no LocalsApp, ele receberá o roteiro completo.'}
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
                <Text style={styles.inputLabel}>{`${(t.travelers.email ?? 'E-MAIL').toUpperCase()} (${(t.common.optional ?? 'opcional').toUpperCase()})`}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={t.travelers.emailPlaceholder}
                  placeholderTextColor={colors.muted}
                  value={emailInput}
                  onChangeText={setEmailInput}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={handleAdd}
                />
                <Text style={styles.inputHint}>
                  {t.travelers.emailHint ?? 'Se informado, um convite será enviado para acesso ao roteiro.'}
                </Text>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => { setShowModal(false); setNameInput(''); setEmailInput(''); }}
                >
                  <Text style={styles.cancelText}>{t.common.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn, !nameInput.trim() && styles.confirmBtnDisabled]}
                  onPress={handleAdd}
                  disabled={!nameInput.trim()}
                >
                  <Text style={styles.confirmText}>{t.common.add}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
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

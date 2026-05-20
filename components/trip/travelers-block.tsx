import React, { useState } from 'react';
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

interface TravelersBlockProps {
  tripId: string;
  travelers: Traveler[];
}

const AVATAR_COLORS = [
  '#4CAF7D', '#5B9BD5', '#E8A838', '#E85D5D', '#9B59B6',
  '#1ABC9C', '#E67E22', '#3498DB', '#E91E63', '#00BCD4',
];

export function TravelersBlock({ tripId, travelers }: TravelersBlockProps) {
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
        'Convite enviado',
        `Um convite foi enviado para ${emailInput.trim()}. Quando aceito, ${name} terá acesso completo ao roteiro no Voyage.`,
        [{ text: 'OK' }]
      );
    }
  };

  const handleRemove = (traveler: Traveler) => {
    Alert.alert(
      'Remover viajante',
      `Deseja remover ${traveler.name} do roteiro?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover',
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
          <Ionicons name="people-outline" size={16} color="#4CAF7D" />
          <Text style={styles.headerTitle}>VIAJANTES</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowModal(true)}>
          <Ionicons name="person-add-outline" size={14} color="#4CAF7D" />
          <Text style={styles.addBtnText}>Adicionar</Text>
        </TouchableOpacity>
      </View>

      {/* Avatar row */}
      <View style={styles.avatarRow}>
        {/* "Me" avatar always first */}
        <View style={[styles.avatar, { backgroundColor: '#2D5A3D' }]}>
          <Text style={styles.avatarText}>EU</Text>
        </View>

        {travelers.map((traveler) => (
          <TouchableOpacity
            key={traveler.id}
            onLongPress={() => handleRemove(traveler)}
            style={[styles.avatar, { backgroundColor: traveler.color || '#4CAF7D' }]}
          >
            <Text style={styles.avatarText}>{traveler.initials}</Text>
            {traveler.inviteStatus === 'pending' && (
              <View style={styles.pendingDot} />
            )}
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={styles.addAvatar} onPress={() => setShowModal(true)}>
          <Ionicons name="add" size={18} color="rgba(255,255,255,0.4)" />
        </TouchableOpacity>
      </View>

      {/* Traveler list */}
      {travelers.length > 0 && (
        <View style={styles.travelerList}>
          {travelers.map((traveler) => (
            <View key={traveler.id} style={styles.travelerRow}>
              <View style={[styles.smallAvatar, { backgroundColor: traveler.color || '#4CAF7D' }]}>
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
                    <Text style={styles.pendingText}>Pendente</Text>
                  </View>
                ) : traveler.isRegistered ? (
                  <View style={styles.activeBadge}>
                    <Text style={styles.activeText}>Ativo</Text>
                  </View>
                ) : null}
                <TouchableOpacity onPress={() => handleRemove(traveler)} style={styles.removeBtn}>
                  <Ionicons name="close" size={14} color="rgba(255,255,255,0.3)" />
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
                <Text style={styles.modalTitle}>Adicionar Viajante</Text>
                <TouchableOpacity onPress={() => setShowModal(false)}>
                  <Ionicons name="close-circle" size={24} color="rgba(255,255,255,0.4)" />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalSubtitle}>
                Se o viajante tiver uma conta no Voyage, ele receberá o roteiro completo e poderá acompanhar em tempo real.
              </Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>NOME</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Nome do viajante"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={nameInput}
                  onChangeText={setNameInput}
                  autoCapitalize="words"
                  returnKeyType="next"
                  autoFocus
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>E-MAIL (OPCIONAL)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="email@exemplo.com"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={emailInput}
                  onChangeText={setEmailInput}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={handleAdd}
                />
                <Text style={styles.inputHint}>
                  Se informado, um convite será enviado para acesso ao roteiro.
                </Text>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => { setShowModal(false); setNameInput(''); setEmailInput(''); }}
                >
                  <Text style={styles.cancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn, !nameInput.trim() && styles.confirmBtnDisabled]}
                  onPress={handleAdd}
                  disabled={!nameInput.trim()}
                >
                  <Text style={styles.confirmText}>Adicionar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255,255,255,0.06)',
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
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(76,175,125,0.15)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  addBtnText: {
    color: '#4CAF7D',
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
    backgroundColor: '#E8A838',
    borderWidth: 2,
    borderColor: '#0F1E14',
  },
  addAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
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
  smallAvatarText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  travelerInfo: {
    flex: 1,
  },
  travelerName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  travelerEmail: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    marginTop: 1,
  },
  travelerStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pendingBadge: {
    backgroundColor: 'rgba(232,168,56,0.15)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pendingText: {
    color: '#E8A838',
    fontSize: 10,
    fontWeight: '600',
  },
  activeBadge: {
    backgroundColor: 'rgba(76,175,125,0.15)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activeText: {
    color: '#4CAF7D',
    fontSize: 10,
    fontWeight: '600',
  },
  removeBtn: {
    padding: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#1A2E22',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 14,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
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
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    fontStyle: 'italic',
    fontFamily: 'serif',
  },
  modalSubtitle: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    lineHeight: 18,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#fff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  inputHint: {
    color: 'rgba(255,255,255,0.3)',
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
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
  },
  cancelText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 15,
    fontWeight: '500',
  },
  confirmBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#2D5A3D',
    alignItems: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.4,
  },
  confirmText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripsStore } from '@/store/trips';
import { generateId, getInitials } from '@/utils/trip-helpers';
import type { Traveler } from '@/types/voyage';

interface TravelersBlockProps {
  tripId: string;
  travelers: Traveler[];
}

const AVATAR_COLORS = ['#1C3D2E', '#3D5A47', '#52B788', '#2D6A4F', '#40916C', '#74C69D'];

export function TravelersBlock({ tripId, travelers }: TravelersBlockProps) {
  const addTraveler = useTripsStore((s) => s.addTraveler);
  const removeTraveler = useTripsStore((s) => s.removeTraveler);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const insets = useSafeAreaInsets();

  const handleAdd = async () => {
    if (!name.trim()) return;
    const traveler: Traveler = {
      id: generateId(),
      name: name.trim(),
      initials: getInitials(name.trim()),
      color: AVATAR_COLORS[travelers.length % AVATAR_COLORS.length],
    };
    await addTraveler(tripId, traveler);
    setShowModal(false);
    setName('');
  };

  return (
    <View
      style={{
        backgroundColor: 'rgba(28,61,46,0.85)',
        borderRadius: 20,
        padding: 16,
        marginBottom: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Ionicons name="people-outline" size={16} color="#52B788" />
        <Text style={{ color: '#F5F0E8', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>
          Viajantes
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        {travelers.map((traveler) => (
          <TouchableOpacity
            key={traveler.id}
            onLongPress={() => removeTraveler(tripId, traveler.id)}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: traveler.color || '#1C3D2E',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: 'rgba(245,240,232,0.3)',
            }}
          >
            <Text style={{ color: '#F5F0E8', fontSize: 14, fontWeight: '700' }}>
              {traveler.initials}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          onPress={() => setShowModal(true)}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: 'rgba(82,183,136,0.2)',
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: 'rgba(82,183,136,0.4)',
            borderStyle: 'dashed',
          }}
        >
          <Ionicons name="add" size={18} color="#52B788" />
        </TouchableOpacity>
      </View>

      {travelers.length > 0 && (
        <Text style={{ color: 'rgba(245,240,232,0.5)', fontSize: 11, marginTop: 8 }}>
          Pressione e segure para remover
        </Text>
      )}

      {/* Add Traveler Modal */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View
              style={{
                backgroundColor: '#F5F0E8',
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                padding: 24,
                paddingBottom: insets.bottom + 24,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ fontSize: 22, fontFamily: 'serif', fontStyle: 'italic', color: '#1C3D2E' }}>
                  Adicionar Viajante
                </Text>
                <TouchableOpacity onPress={() => setShowModal(false)}>
                  <Ionicons name="close-circle" size={26} color="#1C3D2E" />
                </TouchableOpacity>
              </View>

              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Nome do viajante"
                placeholderTextColor="#9BA1A6"
                style={{
                  backgroundColor: '#EDE8DC',
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  color: '#1C3D2E',
                  fontSize: 15,
                  marginBottom: 16,
                }}
                autoFocus
              />

              <TouchableOpacity
                onPress={handleAdd}
                style={{ backgroundColor: '#1C3D2E', borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}
              >
                <Text style={{ color: '#F5F0E8', fontWeight: '600', fontSize: 16 }}>Adicionar</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

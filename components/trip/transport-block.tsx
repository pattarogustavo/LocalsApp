import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripsStore } from '@/store/trips';
import { generateId, formatDate } from '@/utils/trip-helpers';
import type { Transport, FlightInfo } from '@/types/voyage';

interface TransportBlockProps {
  tripId: string;
  transports: Transport[];
}

const TRANSPORT_MODES = [
  { key: 'flight', label: 'Voo', icon: 'airplane' },
  { key: 'car', label: 'Carro', icon: 'car' },
  { key: 'train', label: 'Trem', icon: 'train' },
  { key: 'bus', label: 'Ônibus', icon: 'bus' },
];

export function TransportBlock({ tripId, transports }: TransportBlockProps) {
  const addTransport = useTripsStore((s) => s.addTransport);
  const [showModal, setShowModal] = useState(false);
  const [mode, setMode] = useState<'flight' | 'car' | 'train' | 'bus'>('flight');
  const [flightNumber, setFlightNumber] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [duration, setDuration] = useState('');
  const insets = useSafeAreaInsets();

  const handleAdd = async () => {
    const transport: Transport = {
      id: generateId(),
      mode,
      ...(mode === 'flight' && {
        flight: {
          flightNumber,
          airline: '',
          origin,
          destination,
          departureTime,
          arrivalTime,
          duration,
          status: 'scheduled',
        },
      }),
    };
    await addTransport(tripId, transport);
    setShowModal(false);
    setFlightNumber('');
    setOrigin('');
    setDestination('');
    setDepartureTime('');
    setArrivalTime('');
    setDuration('');
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
      {transports.length === 0 ? (
        <TouchableOpacity
          onPress={() => setShowModal(true)}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="airplane" size={18} color="#52B788" />
            <Text style={{ color: '#F5F0E8', fontSize: 14, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' }}>
              Transporte
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: 'rgba(245,240,232,0.6)', fontSize: 13 }}>Adicionar</Text>
            <Ionicons name="add-circle-outline" size={18} color="#52B788" />
          </View>
        </TouchableOpacity>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={{ color: '#F5F0E8', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>
              Transporte
            </Text>
            <TouchableOpacity onPress={() => setShowModal(true)}>
              <Ionicons name="add-circle-outline" size={18} color="#52B788" />
            </TouchableOpacity>
          </View>

          {transports.map((t) => (
            <View key={t.id}>
              {t.mode === 'flight' && t.flight && (
                <FlightCard flight={t.flight} />
              )}
              {t.mode === 'car' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Ionicons name="car" size={20} color="#52B788" />
                  <View>
                    <Text style={{ color: '#F5F0E8', fontWeight: '600' }}>Carro</Text>
                    {t.distance && <Text style={{ color: 'rgba(245,240,232,0.7)', fontSize: 12 }}>{t.distance} · {t.travelTime}</Text>}
                  </View>
                </View>
              )}
              {t.mode === 'train' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Ionicons name="train" size={20} color="#52B788" />
                  <View>
                    <Text style={{ color: '#F5F0E8', fontWeight: '600' }}>Trem {t.trainNumber}</Text>
                    {t.station && <Text style={{ color: 'rgba(245,240,232,0.7)', fontSize: 12 }}>{t.station}</Text>}
                  </View>
                </View>
              )}
            </View>
          ))}
        </>
      )}

      {/* Add Transport Modal */}
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
                  Adicionar Transporte
                </Text>
                <TouchableOpacity onPress={() => setShowModal(false)}>
                  <Ionicons name="close-circle" size={26} color="#1C3D2E" />
                </TouchableOpacity>
              </View>

              {/* Mode selector */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                {TRANSPORT_MODES.map((m) => (
                  <TouchableOpacity
                    key={m.key}
                    onPress={() => setMode(m.key as any)}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      paddingVertical: 10,
                      borderRadius: 12,
                      backgroundColor: mode === m.key ? '#1C3D2E' : '#EDE8DC',
                    }}
                  >
                    <Ionicons name={m.icon as any} size={18} color={mode === m.key ? '#F5F0E8' : '#1C3D2E'} />
                    <Text style={{ fontSize: 11, marginTop: 2, color: mode === m.key ? '#F5F0E8' : '#1C3D2E' }}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {mode === 'flight' && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <InputField label="Número do Voo" value={flightNumber} onChangeText={setFlightNumber} placeholder="Ex: LA8084" />
                  <InputField label="Origem" value={origin} onChangeText={setOrigin} placeholder="Ex: GRU" />
                  <InputField label="Destino" value={destination} onChangeText={setDestination} placeholder="Ex: LHR" />
                  <InputField label="Partida" value={departureTime} onChangeText={setDepartureTime} placeholder="Ex: 22:30" />
                  <InputField label="Chegada" value={arrivalTime} onChangeText={setArrivalTime} placeholder="Ex: 10:45" />
                  <InputField label="Duração" value={duration} onChangeText={setDuration} placeholder="Ex: 12h15" />
                </ScrollView>
              )}

              <TouchableOpacity
                onPress={handleAdd}
                style={{
                  backgroundColor: '#1C3D2E',
                  borderRadius: 16,
                  paddingVertical: 16,
                  alignItems: 'center',
                  marginTop: 16,
                }}
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

function FlightCard({ flight }: { flight: FlightInfo }) {
  const statusColors: Record<string, string> = {
    scheduled: '#52B788',
    delayed: '#F59E0B',
    boarding: '#3B82F6',
    departed: '#8B5CF6',
    arrived: '#52B788',
    cancelled: '#EF4444',
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: 'rgba(82,183,136,0.2)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="airplane" size={18} color="#52B788" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#F5F0E8', fontWeight: '700', fontSize: 16 }}>
            {flight.origin} → {flight.destination}
          </Text>
          <Text style={{ color: 'rgba(245,240,232,0.7)', fontSize: 12 }}>
            {flight.flightNumber}{flight.duration ? ` · ${flight.duration}` : ''}
          </Text>
        </View>
        {flight.departureTime && (
          <Text style={{ color: 'rgba(245,240,232,0.8)', fontSize: 14, fontWeight: '600' }}>
            {flight.departureTime}
          </Text>
        )}
      </View>

      {(flight.terminal || flight.gate || flight.status) && (
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(245,240,232,0.1)' }}>
          {flight.terminal && (
            <View>
              <Text style={{ color: 'rgba(245,240,232,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Terminal</Text>
              <Text style={{ color: '#F5F0E8', fontSize: 13, fontWeight: '600' }}>{flight.terminal}</Text>
            </View>
          )}
          {flight.gate && (
            <View>
              <Text style={{ color: 'rgba(245,240,232,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Gate</Text>
              <Text style={{ color: '#F5F0E8', fontSize: 13, fontWeight: '600' }}>{flight.gate}</Text>
            </View>
          )}
          {flight.status && (
            <View>
              <Text style={{ color: 'rgba(245,240,232,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Status</Text>
              <Text style={{ color: statusColors[flight.status] || '#52B788', fontSize: 13, fontWeight: '600', textTransform: 'capitalize' }}>
                {flight.status}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function InputField({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: '#6B7C72', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9BA1A6"
        style={{
          backgroundColor: '#EDE8DC',
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          color: '#1C3D2E',
          fontSize: 15,
        }}
      />
    </View>
  );
}

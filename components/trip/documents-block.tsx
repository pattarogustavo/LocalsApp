import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripsStore } from '@/store/trips';
import { generateId } from '@/utils/trip-helpers';
import type { Document } from '@/types/voyage';
import { useTranslation } from '@/hooks/use-translation';

interface DocumentsBlockProps {
  tripId: string;
  documents: Document[];
}

const DOC_TYPES = [
  { key: 'passport', label: 'Passaporte', icon: 'document-text' },
  { key: 'visa', label: 'Visto', icon: 'card' },
  { key: 'ticket', label: 'Passagem', icon: 'airplane' },
  { key: 'reservation', label: 'Reserva', icon: 'bed' },
  { key: 'insurance', label: 'Seguro', icon: 'shield-checkmark' },
  { key: 'other', label: 'Outro', icon: 'folder' },
];

export function DocumentsBlock({ tripId, documents }: DocumentsBlockProps) {
  const t = useTranslation();
  const addDocument = useTripsStore((s) => s.addDocument);
  const removeDocument = useTripsStore((s) => s.removeDocument);
  const [showModal, setShowModal] = useState(false);
  const [docName, setDocName] = useState('');
  const [docType, setDocType] = useState<Document['type']>('other');
  const insets = useSafeAreaInsets();

  const handleAdd = async () => {
    if (!docName.trim()) return;
    const doc: Document = {
      id: generateId(),
      name: docName.trim(),
      type: docType,
    };
    await addDocument(tripId, doc);
    setShowModal(false);
    setDocName('');
    setDocType('other');
  };

  const handleOpenDoc = (doc: Document) => {
    if (doc.url) {
      Linking.openURL(doc.url).catch(() =>
        Alert.alert(t.common.error, t.documentsExtra.openError)
      );
    } else {
      Alert.alert(t.documents.noUrl, t.documents.noUrl);
    }
  };

  return (
    <View
      style={{
        backgroundColor: 'rgba(44,36,22,0.5)',
        borderRadius: 20,
        padding: 16,
        marginBottom: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: documents.length > 0 ? 12 : 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="document-text-outline" size={16} color="#3D5A2E" />
          <Text style={{ color: '#F0EBE0', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>
            {t.documents.title}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setShowModal(true)}>
          <Text style={{ color: '#3D5A2E', fontSize: 13 }}>{t.documents.openDocument}</Text>
        </TouchableOpacity>
      </View>

      {documents.length === 0 ? (
        <TouchableOpacity onPress={() => setShowModal(true)}>
          <Text style={{ color: 'rgba(240,235,224,0.9)', fontSize: 13, marginTop: 4 }}>
            {t.documents.noDocuments}
          </Text>
        </TouchableOpacity>
      ) : (
        documents.slice(0, 3).map((doc) => {
          const typeInfo = DOC_TYPES.find((t) => t.key === doc.type) || DOC_TYPES[5];
          return (
            <TouchableOpacity
              key={doc.id}
              onPress={() => handleOpenDoc(doc)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}
              activeOpacity={0.7}
            >
              <Ionicons name={typeInfo.icon as any} size={16} color="rgba(240,235,224,0.9)" />
              <Text style={{ color: '#F0EBE0', fontSize: 14, flex: 1 }}>{doc.name}</Text>
              {doc.url ? (
                <Ionicons name="open-outline" size={13} color="rgba(82,183,136,0.6)" />
              ) : null}
              <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); removeDocument(tripId, doc.id); }}>
                <Ionicons name="trash-outline" size={14} color="rgba(240,235,224,0.9)" />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })
      )}

      {/* Add Document Modal */}
      <Modal visible={showModal} transparent animationType="slide">
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end' }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <View
              style={{
                backgroundColor: '#F0EBE0',
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                padding: 24,
                paddingBottom: insets.bottom + 24,
                maxHeight: '90%',
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ fontSize: 22, fontFamily: 'serif', fontStyle: 'italic', color: '#2C2416' }}>
                  {t.documents.title}
                </Text>
                <TouchableOpacity onPress={() => setShowModal(false)}>
                  <Ionicons name="close-circle" size={26} color="#2C2416" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Existing docs */}
              {documents.map((doc) => {
                const typeInfo = DOC_TYPES.find((t) => t.key === doc.type) || DOC_TYPES[5];
                return (
                  <TouchableOpacity
                    key={doc.id}
                    onPress={() => handleOpenDoc(doc)}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      backgroundColor: '#EDE8DC',
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 8,
                    }}
                  >
                    <Ionicons name={typeInfo.icon as any} size={18} color="#3D5A47" />
                    <Text style={{ color: '#2C2416', flex: 1, fontWeight: '500' }}>{doc.name}</Text>
                    {doc.url ? (
                      <Ionicons name="open-outline" size={14} color="#3D5A47" />
                    ) : null}
                    <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); removeDocument(tripId, doc.id); }}>
                      <Ionicons name="trash-outline" size={16} color="#C0392B" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}

              <Text style={{ color: '#6B7C72', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 8 }}>
                {t.common.type ?? 'Tipo'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {DOC_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    onPress={() => setDocType(t.key as any)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 20,
                      backgroundColor: docType === t.key ? '#2C2416' : '#EDE8DC',
                    }}
                  >
                    <Ionicons name={t.icon as any} size={14} color={docType === t.key ? '#F0EBE0' : '#2C2416'} />
                    <Text style={{ fontSize: 12, color: docType === t.key ? '#F0EBE0' : '#2C2416' }}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                value={docName}
                onChangeText={setDocName}
                placeholder={t.documents.namePlaceholder}
                placeholderTextColor="#9BA1A6"
                style={{
                  backgroundColor: '#EDE8DC',
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  color: '#2C2416',
                  fontSize: 15,
                  marginBottom: 12,
                }}
              />

              <TouchableOpacity
                onPress={handleAdd}
                style={{
                  backgroundColor: '#2C2416',
                  borderRadius: 16,
                  paddingVertical: 16,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#F0EBE0', fontWeight: '600', fontSize: 16 }}>{t.documents.addDocument}</Text>
              </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

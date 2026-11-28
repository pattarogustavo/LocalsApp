import React from 'react';
import { View, Text, TouchableOpacity, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTripsStore } from '@/store/trips';
import type { Document } from '@/types/voyage';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import type { TripPermissions } from '@/hooks/use-trip-permissions';

interface DocumentsBlockProps {
  tripId: string;
  documents: Document[];
  permissions: TripPermissions;
}

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

const DOC_TYPES = [
  { key: 'passport', label: 'Passaporte', icon: 'document-text' },
  { key: 'visa', label: 'Visto', icon: 'card' },
  { key: 'ticket', label: 'Passagem', icon: 'airplane' },
  { key: 'reservation', label: 'Reserva', icon: 'bed' },
  { key: 'insurance', label: 'Seguro', icon: 'shield-checkmark' },
  { key: 'other', label: 'Outro', icon: 'folder' },
];

export function DocumentsBlock({ tripId, documents, permissions }: DocumentsBlockProps) {
  const canEdit = permissions.canEdit;
  const t = useTranslation();
  const colors = useColors();
  const removeDocument = useTripsStore((s) => s.removeDocument);

  const openAddDocument = () => router.push({ pathname: '/trip/[id]/add-document', params: { id: tripId, tripId } });

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
        backgroundColor: colors.surface,
        borderRadius: 20,
        padding: 16,
        marginBottom: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: documents.length > 0 ? 12 : 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="document-text-outline" size={16} color={colors.textAccent} />
          <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>
            {t.documents.title}
          </Text>
        </View>
        {canEdit && (
          <TouchableOpacity
            onPress={() => openAddDocument()}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: withAlpha(colors.primary, 0.15),
              borderRadius: 20,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Ionicons name="add" size={14} color={colors.textAccent} />
            <Text style={{ color: colors.textAccent, fontSize: 12, fontWeight: '600' }}>{t.common.add}</Text>
          </TouchableOpacity>
        )}
      </View>

      {documents.length === 0 ? (
        canEdit ? (
          <TouchableOpacity onPress={() => openAddDocument()}>
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
              {t.documents.noDocuments}
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
            {t.documents.noDocuments}
          </Text>
        )
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
              <Ionicons name={typeInfo.icon as any} size={16} color={colors.muted} />
              <Text style={{ color: colors.foreground, fontSize: 14, flex: 1 }}>{doc.name}</Text>
              {doc.url ? (
                <Ionicons name="open-outline" size={13} color={withAlpha(colors.primary, 0.6)} />
              ) : null}
              {canEdit && (
                <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); removeDocument(tripId, doc.id); }}>
                  <Ionicons name="trash-outline" size={14} color={colors.muted} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        })
      )}

    </View>
  );
}

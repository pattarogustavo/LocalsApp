import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, TextInput, StyleSheet } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTripsStore } from '@/store/trips';
import { generateId } from '@/utils/trip-helpers';
import type { TripPhoto } from '@/types/voyage';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { sheetScreenOptions } from '@/utils/sheet-presentation';
import { useDiscardConfirmation } from '@/hooks/use-discard-confirmation';

export default function PhotoCaptionScreen() {
  const { tripId, pendingUri } = useLocalSearchParams<{ tripId: string; pendingUri: string }>();
  const t = useTranslation();
  const colors = useColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const addPhoto = useTripsStore((s) => s.addPhoto);
  const [captionInput, setCaptionInput] = useState('');

  useDiscardConfirmation(captionInput.trim().length > 0);

  const confirmAddPhoto = async () => {
    const photo: TripPhoto = {
      id: generateId(),
      url: pendingUri,
      caption: captionInput.trim() || undefined,
      uploadedBy: t.travelers.you ?? 'Eu',
      uploadedAt: new Date().toISOString(),
    };
    await addPhoto(tripId, photo);
    router.back();
  };

  return (
    <>
      <Stack.Screen options={sheetScreenOptions(colors)} />
      <View style={styles.captionModalSheet}>
        <Text style={styles.captionModalTitle}>{t.photos.addCaption ?? 'Adicionar legenda'}</Text>
        {pendingUri ? <Image source={{ uri: pendingUri }} style={styles.captionPreview} resizeMode="cover" /> : null}
        <TextInput
          style={styles.captionInput}
          placeholder={t.photos.captionPlaceholder}
          placeholderTextColor={colors.muted}
          value={captionInput}
          onChangeText={setCaptionInput}
          maxLength={120}
          returnKeyType="done"
          onSubmitEditing={confirmAddPhoto}
        />
        <View style={styles.captionModalActions}>
          <TouchableOpacity style={styles.captionCancelBtn} onPress={() => router.back()}>
            <Text style={styles.captionCancelText}>{t.common.cancel}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.captionConfirmBtn} onPress={confirmAddPhoto}>
            <Text style={styles.captionConfirmText}>{t.common.add}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  captionModalSheet: { backgroundColor: colors.background, padding: 20, gap: 12 },
  captionModalTitle: { color: colors.foreground, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  captionPreview: { width: '100%', height: 180, borderRadius: 12 },
  captionInput: { backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: colors.foreground, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  captionModalActions: { flexDirection: 'row', gap: 10, marginTop: 4, paddingBottom: 8 },
  captionCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center' },
  captionCancelText: { color: colors.muted, fontSize: 15, fontWeight: '500' },
  captionConfirmBtn: { flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center' },
  captionConfirmText: { color: colors.textOnPrimary, fontSize: 15, fontWeight: '600' },
});

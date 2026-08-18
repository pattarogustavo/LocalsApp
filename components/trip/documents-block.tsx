import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView, Linking, Alert, Image, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripsStore } from '@/store/trips';
import { generateId } from '@/utils/trip-helpers';
import type { Document } from '@/types/voyage';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { trpcVanilla } from '@/lib/trpc-vanilla';
import { getApiBaseUrl } from '@/constants/api';

async function uploadTripDocumentFile(params: {
  tripId: string;
  uri: string;
  fileName: string;
  contentType: string;
}): Promise<string> {
  const base64Data = await FileSystem.readAsStringAsync(params.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const result = await trpcVanilla.tripDocuments.upload.mutate({
    tripId: params.tripId,
    fileName: params.fileName,
    contentType: params.contentType,
    base64Data,
  });
  return `${getApiBaseUrl()}${result.url}`;
}

interface DocumentsBlockProps {
  tripId: string;
  documents: Document[];
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

export function DocumentsBlock({ tripId, documents }: DocumentsBlockProps) {
  const t = useTranslation();
  const colors = useColors();
  const addDocument = useTripsStore((s) => s.addDocument);
  const removeDocument = useTripsStore((s) => s.removeDocument);
  const [showModal, setShowModal] = useState(false);
  const [docName, setDocName] = useState('');
  const [docType, setDocType] = useState<Document['type']>('other');
  const [showAttachOptions, setShowAttachOptions] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachedUrl, setAttachedUrl] = useState<string | null>(null);
  const [attachedPreviewUri, setAttachedPreviewUri] = useState<string | null>(null);
  const [attachedFileName, setAttachedFileName] = useState<string | null>(null);
  const [attachedIsImage, setAttachedIsImage] = useState(false);
  const insets = useSafeAreaInsets();

  const resetForm = () => {
    setDocName('');
    setDocType('other');
    setShowAttachOptions(false);
    setUploading(false);
    setAttachedUrl(null);
    setAttachedPreviewUri(null);
    setAttachedFileName(null);
    setAttachedIsImage(false);
  };

  const handleAdd = async () => {
    if (!docName.trim() || uploading) return;
    const doc: Document = {
      id: generateId(),
      name: docName.trim(),
      type: docType,
      url: attachedUrl ?? undefined,
    };
    await addDocument(tripId, doc);
    setShowModal(false);
    resetForm();
  };

  const handleAttachedAsset = async (uri: string, fileName: string, contentType: string) => {
    setShowAttachOptions(false);
    setUploading(true);
    try {
      const url = await uploadTripDocumentFile({ tripId, uri, fileName, contentType });
      setAttachedUrl(url);
      setAttachedPreviewUri(uri);
      setAttachedFileName(fileName);
      setAttachedIsImage(contentType.startsWith('image/'));
      if (!docName.trim()) {
        setDocName(fileName.replace(/\.[^/.]+$/, ''));
      }
    } catch (err) {
      console.error('[DocumentsBlock] upload failed:', err);
      Alert.alert(t.common.error, t.documents.uploadError);
    } finally {
      setUploading(false);
    }
  };

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t.photos.permissionTitle ?? 'Permissão', t.photos.cameraPermission ?? 'Precisamos de acesso à câmera.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const contentType = asset.mimeType || 'image/jpeg';
      const fileName = asset.fileName || `photo-${Date.now()}.jpg`;
      await handleAttachedAsset(asset.uri, fileName, contentType);
    }
  };

  const handlePickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t.photos.permissionTitle ?? 'Permissão', t.photos.galleryPermission ?? 'Precisamos de acesso à galeria.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const contentType = asset.mimeType || 'image/jpeg';
      const fileName = asset.fileName || `photo-${Date.now()}.jpg`;
      await handleAttachedAsset(asset.uri, fileName, contentType);
    }
  };

  const handlePickFile = async () => {
    setShowAttachOptions(false);
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const contentType = asset.mimeType || 'application/octet-stream';
      await handleAttachedAsset(asset.uri, asset.name, contentType);
    }
  };

  const handleRemoveAttachment = () => {
    setAttachedUrl(null);
    setAttachedPreviewUri(null);
    setAttachedFileName(null);
    setAttachedIsImage(false);
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
        <TouchableOpacity
          onPress={() => setShowModal(true)}
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
      </View>

      {documents.length === 0 ? (
        <TouchableOpacity onPress={() => setShowModal(true)}>
          <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
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
              <Ionicons name={typeInfo.icon as any} size={16} color={colors.muted} />
              <Text style={{ color: colors.foreground, fontSize: 14, flex: 1 }}>{doc.name}</Text>
              {doc.url ? (
                <Ionicons name="open-outline" size={13} color={withAlpha(colors.primary, 0.6)} />
              ) : null}
              <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); removeDocument(tripId, doc.id); }}>
                <Ionicons name="trash-outline" size={14} color={colors.muted} />
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
          <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlayModal }}>
            <View
              style={{
                backgroundColor: colors.background,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                padding: 24,
                paddingBottom: insets.bottom + 24,
                maxHeight: '90%',
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ fontSize: 22, fontFamily: 'serif', fontStyle: 'italic', color: colors.foreground }}>
                  {t.documents.title}
                </Text>
                <TouchableOpacity onPress={() => { setShowModal(false); resetForm(); }}>
                  <Ionicons name="close-circle" size={26} color={colors.foreground} />
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
                      backgroundColor: colors.surface,
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 8,
                    }}
                  >
                    <Ionicons name={typeInfo.icon as any} size={18} color={colors.textAccent} />
                    <Text style={{ color: colors.foreground, flex: 1, fontWeight: '500' }}>{doc.name}</Text>
                    {doc.url ? (
                      <Ionicons name="open-outline" size={14} color={colors.textAccent} />
                    ) : null}
                    <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); removeDocument(tripId, doc.id); }}>
                      <Ionicons name="trash-outline" size={16} color={colors.error} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}

              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 8 }}>
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
                      backgroundColor: docType === t.key ? colors.primary : colors.surface,
                    }}
                  >
                    <Ionicons name={t.icon as any} size={14} color={docType === t.key ? colors.textOnPrimary : colors.foreground} />
                    <Text style={{ fontSize: 12, color: docType === t.key ? colors.textOnPrimary : colors.foreground }}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                value={docName}
                onChangeText={setDocName}
                placeholder={t.documents.namePlaceholder}
                placeholderTextColor={colors.muted}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  color: colors.foreground,
                  fontSize: 15,
                  marginBottom: 12,
                }}
              />

              {/* Attach photo/file */}
              {uploading ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    borderRadius: 12,
                    paddingVertical: 14,
                    paddingHorizontal: 16,
                    backgroundColor: withAlpha(colors.primary, 0.08),
                    marginBottom: 12,
                  }}
                >
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={{ color: colors.foreground, fontSize: 13 }}>{t.documents.uploading}</Text>
                </View>
              ) : attachedUrl ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    borderRadius: 12,
                    padding: 10,
                    backgroundColor: colors.surface,
                    marginBottom: 12,
                  }}
                >
                  {attachedIsImage && attachedPreviewUri ? (
                    <Image source={{ uri: attachedPreviewUri }} style={{ width: 44, height: 44, borderRadius: 8 }} />
                  ) : (
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 8,
                        backgroundColor: withAlpha(colors.primary, 0.1),
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name="document-text" size={22} color={colors.primary} />
                    </View>
                  )}
                  <Text style={{ color: colors.foreground, fontSize: 13, flex: 1 }} numberOfLines={1}>
                    {attachedFileName}
                  </Text>
                  <TouchableOpacity onPress={handleRemoveAttachment}>
                    <Ionicons name="close-circle" size={22} color={colors.error} />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    onPress={() => setShowAttachOptions((v) => !v)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      borderWidth: 1,
                      borderColor: withAlpha(colors.primary, 0.35),
                      borderStyle: 'dashed',
                      borderRadius: 12,
                      paddingVertical: 12,
                      paddingHorizontal: 16,
                      backgroundColor: withAlpha(colors.primary, 0.06),
                      marginBottom: showAttachOptions ? 8 : 12,
                    }}
                  >
                    <Ionicons name="attach-outline" size={16} color={colors.primary} />
                    <Text style={{ fontSize: 13, color: colors.primary, fontWeight: '500' }}>
                      {t.documents.attachFileOrPhoto}
                    </Text>
                  </TouchableOpacity>

                  {showAttachOptions && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                      <TouchableOpacity
                        onPress={handleTakePhoto}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          paddingVertical: 8,
                          paddingHorizontal: 12,
                          borderRadius: 20,
                          backgroundColor: withAlpha(colors.foreground, 0.08),
                        }}
                      >
                        <Ionicons name="camera-outline" size={15} color={colors.foreground} />
                        <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: '500' }}>
                          {t.documents.takePhoto}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handlePickFromGallery}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          paddingVertical: 8,
                          paddingHorizontal: 12,
                          borderRadius: 20,
                          backgroundColor: withAlpha(colors.foreground, 0.08),
                        }}
                      >
                        <Ionicons name="images-outline" size={15} color={colors.foreground} />
                        <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: '500' }}>
                          {t.documents.chooseFromGallery}
                        </Text>
                      </TouchableOpacity>
                      {Platform.OS !== 'web' && (
                        <TouchableOpacity
                          onPress={handlePickFile}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            paddingVertical: 8,
                            paddingHorizontal: 12,
                            borderRadius: 20,
                            backgroundColor: withAlpha(colors.foreground, 0.08),
                          }}
                        >
                          <Ionicons name="document-outline" size={15} color={colors.foreground} />
                          <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: '500' }}>
                            {t.documents.chooseFile}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </>
              )}

              <TouchableOpacity
                onPress={handleAdd}
                activeOpacity={0.7}
                disabled={uploading}
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: 16,
                  paddingVertical: 16,
                  alignItems: 'center',
                  opacity: uploading ? 0.6 : 1,
                }}
              >
                <Text style={{ color: colors.textOnPrimary, fontWeight: '600', fontSize: 16 }}>{t.documents.addDocument}</Text>
              </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

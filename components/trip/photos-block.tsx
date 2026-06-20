import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  FlatList,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  ScrollView,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTripsStore } from '@/store/trips';
import { generateId } from '@/utils/trip-helpers';
import type { TripPhoto } from '@/types/voyage';
import { useTranslation } from '@/hooks/use-translation';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PHOTO_SIZE = (SCREEN_WIDTH - 48 - 8) / 3; // 3 columns with padding

interface Props {
  tripId: string;
  tripName: string;
  fullPage?: boolean;
}

export function TripPhotosBlock({ tripId, tripName, fullPage }: Props) {
  const t = useTranslation();
  const { trips, addPhoto, removePhoto } = useTripsStore();
  const trip = trips.find((t) => t.id === tripId);
  const photos = trip?.photos || [];

  const [selectedPhoto, setSelectedPhoto] = useState<TripPhoto | null>(null);
  const [captionInput, setCaptionInput] = useState('');
  const [showCaptionModal, setShowCaptionModal] = useState(false);
  const [pendingUri, setPendingUri] = useState<string | null>(null);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t.photos.permissionTitle ?? 'Permissão', t.photos.galleryPermission ?? 'Precisamos de acesso à galeria.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets.length > 0) {
      if (result.assets.length === 1) {
        // Single photo — ask for caption
        setPendingUri(result.assets[0].uri);
        setCaptionInput('');
        setShowCaptionModal(true);
      } else {
        // Multiple photos — add all without captions
        for (const asset of result.assets) {
          const photo: TripPhoto = {
            id: generateId(),
            url: asset.uri,
            uploadedBy: t.travelers.you ?? 'Eu',
            uploadedAt: new Date().toISOString(),
          };
          await addPhoto(tripId, photo);
        }
      }
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t.photos.permissionTitle ?? 'Permissão', t.photos.cameraPermission ?? 'Precisamos de acesso à câmera.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPendingUri(result.assets[0].uri);
      setCaptionInput('');
      setShowCaptionModal(true);
    }
  };

  const confirmAddPhoto = async () => {
    if (!pendingUri) return;
    const photo: TripPhoto = {
      id: generateId(),
      url: pendingUri,
      caption: captionInput.trim() || undefined,
      uploadedBy: t.travelers.you ?? 'Eu',
      uploadedAt: new Date().toISOString(),
    };
    await addPhoto(tripId, photo);
    setPendingUri(null);
    setCaptionInput('');
    setShowCaptionModal(false);
  };

  const handleDelete = (photo: TripPhoto) => {
    Alert.alert(t.photos.deletePhoto, t.photos.deleteConfirm, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.common.delete,
        style: 'destructive',
        onPress: () => removePhoto(tripId, photo.id),
      },
    ]);
  };

  const showOptions = () => {
    Alert.alert(t.photos.addPhoto, t.photos.chooseOption ?? 'Escolha uma opção', [
      { text: t.photos.camera ?? 'Câmera', onPress: takePhoto },
      { text: t.photos.gallery ?? 'Galeria', onPress: pickImage },
      { text: t.common.cancel, style: 'cancel' },
    ]);
  };

  return (
    <View style={[styles.container, fullPage && styles.containerFullPage]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="images-outline" size={16} color="#4CAF7D" />
          <Text style={styles.headerTitle}>{fullPage ? (t.photos.tripPhotos ?? 'FOTOS DA VIAGEM') : (t.photos.tripAlbum ?? 'ÁLBUM DA VIAGEM')}</Text>
          {photos.length > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{photos.length}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={showOptions}>
          <Ionicons name="add" size={16} color="#4CAF7D" />
          <Text style={styles.addBtnText}>{t.common.add}</Text>
        </TouchableOpacity>
      </View>

      {photos.length === 0 ? (
        <TouchableOpacity style={styles.emptyState} onPress={showOptions}>
          <Ionicons name="camera-outline" size={28} color="rgba(255,255,255,0.3)" />
          <Text style={styles.emptyText}>{t.photos.emptyText ?? 'Adicione fotos da sua viagem'}</Text>
          <Text style={styles.emptySubtext}>{t.photos.emptySubtext ?? 'Compartilhadas com todos os viajantes'}</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.grid}>
          {photos.map((photo) => (
            <TouchableOpacity
              key={photo.id}
              style={styles.photoCell}
              onPress={() => setSelectedPhoto(photo)}
              onLongPress={() => handleDelete(photo)}
            >
              <Image source={{ uri: photo.url }} style={styles.photoThumb} />
              {photo.caption ? (
                <View style={styles.captionOverlay}>
                  <Text style={styles.captionText} numberOfLines={1}>{photo.caption}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          ))}
          {/* Add more button */}
          <TouchableOpacity style={styles.addMoreCell} onPress={showOptions}>
            <Ionicons name="add" size={24} color="rgba(255,255,255,0.4)" />
          </TouchableOpacity>
        </View>
      )}

      {/* Photo detail modal */}
      <Modal
        visible={selectedPhoto !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalClose} onPress={() => setSelectedPhoto(null)}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          {selectedPhoto && (
            <>
              <Image
                source={{ uri: selectedPhoto.url }}
                style={styles.fullImage}
                resizeMode="contain"
              />
              <View style={styles.photoMeta}>
                {selectedPhoto.caption ? (
                  <Text style={styles.photoCaption}>{selectedPhoto.caption}</Text>
                ) : null}
                <Text style={styles.photoBy}>
                  {t.photos.addedBy ?? 'Adicionado por'} {selectedPhoto.uploadedBy} •{' '}
                  {new Date(selectedPhoto.uploadedAt).toLocaleDateString()}
                </Text>
                <TouchableOpacity
                  style={styles.deletePhotoBtn}
                  onPress={() => {
                    setSelectedPhoto(null);
                    setTimeout(() => handleDelete(selectedPhoto), 300);
                  }}
                >
                  <Ionicons name="trash-outline" size={16} color="#ff6b6b" />
                  <Text style={styles.deletePhotoText}>{t.photos.deletePhoto}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>

      {/* Caption input modal */}
      <Modal
        visible={showCaptionModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCaptionModal(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end' }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <View style={styles.captionModalOverlay}>
          <View style={styles.captionModalSheet}>
            <Text style={styles.captionModalTitle}>{t.photos.addCaption ?? 'Adicionar legenda'}</Text>
            {pendingUri && (
              <Image source={{ uri: pendingUri }} style={styles.captionPreview} resizeMode="cover" />
            )}
            <TextInput
              style={styles.captionInput}
              placeholder={t.photos.captionPlaceholder}
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={captionInput}
              onChangeText={setCaptionInput}
              maxLength={120}
              returnKeyType="done"
              onSubmitEditing={confirmAddPhoto}
            />
            <View style={styles.captionModalActions}>
              <TouchableOpacity
                style={styles.captionCancelBtn}
                onPress={() => { setShowCaptionModal(false); setPendingUri(null); }}
              >
                <Text style={styles.captionCancelText}>{t.common.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.captionConfirmBtn} onPress={confirmAddPhoto}>
                <Text style={styles.captionConfirmText}>{t.common.add}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
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
  containerFullPage: {
    backgroundColor: 'transparent',
    padding: 0,
    marginBottom: 0,
  },
  countBadge: {
    backgroundColor: 'rgba(76,175,125,0.2)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: 4,
  },
  countText: {
    color: '#4CAF7D',
    fontSize: 11,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
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
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 6,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontWeight: '500',
  },
  emptySubtext: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  photoCell: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: 8,
    overflow: 'hidden',
  },
  photoThumb: {
    width: '100%',
    height: '100%',
  },
  captionOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  captionText: {
    color: '#fff',
    fontSize: 9,
  },
  addMoreCell: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderStyle: 'dashed',
  },
  // Full image modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalClose: {
    position: 'absolute',
    top: 56,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    padding: 8,
  },
  fullImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH,
  },
  photoMeta: {
    marginTop: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 6,
  },
  photoCaption: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  photoBy: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },
  deletePhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,107,107,0.1)',
    borderRadius: 12,
  },
  deletePhotoText: {
    color: '#ff6b6b',
    fontSize: 13,
  },
  // Caption modal
  captionModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  captionModalSheet: {
    backgroundColor: '#1A2E22',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 12,
  },
  captionModalTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  captionPreview: {
    width: '100%',
    height: 180,
    borderRadius: 12,
  },
  captionInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  captionModalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    paddingBottom: 8,
  },
  captionCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  captionCancelText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 15,
    fontWeight: '500',
  },
  captionConfirmBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#2D5A3D',
    alignItems: 'center',
  },
  captionConfirmText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

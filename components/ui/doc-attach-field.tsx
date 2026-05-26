import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

interface DocAttachFieldProps {
  label: string;
  uri: string | null;
  onPick: (uri: string) => void;
  onRemove: () => void;
}

/**
 * A field that lets the user attach a PDF or photo (e.g. boarding pass, hotel confirmation, rental contract).
 * On tap, shows a picker: Camera, Gallery, or PDF (native only).
 */
export function DocAttachField({ label, uri, onPick, onRemove }: DocAttachFieldProps) {
  const [showOptions, setShowOptions] = React.useState(false);

  const pickFromGallery = async () => {
    setShowOptions(false);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      onPick(result.assets[0].uri);
    }
  };

  const pickFromCamera = async () => {
    setShowOptions(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') return;
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.85,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      onPick(result.assets[0].uri);
    }
  };

  const pickPdf = async () => {
    setShowOptions(false);
    if (Platform.OS === 'web') return;
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets[0]) {
      onPick(result.assets[0].uri);
    }
  };

  const isPdf = uri?.toLowerCase().endsWith('.pdf');

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>

      {uri ? (
        <View style={styles.previewRow}>
          {isPdf ? (
            <View style={styles.pdfPreview}>
              <Ionicons name="document-text" size={28} color="#52B788" />
              <Text style={styles.pdfLabel} numberOfLines={1}>Documento anexado</Text>
            </View>
          ) : (
            <Image source={{ uri }} style={styles.imagePreview} resizeMode="cover" />
          )}
          <TouchableOpacity style={styles.removeBtn} onPress={onRemove}>
            <Ionicons name="close-circle" size={22} color="#EF4444" />
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowOptions(!showOptions)}>
            <Ionicons name="attach-outline" size={16} color="#52B788" />
            <Text style={styles.addBtnText}>Anexar documento</Text>
          </TouchableOpacity>

          {showOptions && (
            <View style={styles.optionsRow}>
              <TouchableOpacity style={styles.optionChip} onPress={pickFromCamera}>
                <Ionicons name="camera-outline" size={15} color="#F5F0E8" />
                <Text style={styles.optionText}>Câmera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.optionChip} onPress={pickFromGallery}>
                <Ionicons name="images-outline" size={15} color="#F5F0E8" />
                <Text style={styles.optionText}>Galeria</Text>
              </TouchableOpacity>
              {Platform.OS !== 'web' && (
                <TouchableOpacity style={styles.optionChip} onPress={pickPdf}>
                  <Ionicons name="document-outline" size={15} color="#F5F0E8" />
                  <Text style={styles.optionText}>PDF</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    color: 'rgba(245,240,232,0.5)',
    marginBottom: 8,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.35)',
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(82,183,136,0.06)',
  },
  addBtnText: {
    fontSize: 13,
    color: '#52B788',
    fontWeight: '500',
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  optionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  optionText: {
    fontSize: 12,
    color: '#F5F0E8',
    fontWeight: '500',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  imagePreview: {
    width: 80,
    height: 80,
    borderRadius: 10,
    flex: 1,
  },
  pdfPreview: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(82,183,136,0.08)',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.2)',
  },
  pdfLabel: {
    fontSize: 13,
    color: '#52B788',
    fontWeight: '500',
    flex: 1,
  },
  removeBtn: {
    padding: 4,
  },
});

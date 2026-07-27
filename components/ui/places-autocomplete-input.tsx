import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { trpc } from '@/lib/trpc';
import { useColors } from '@/hooks/use-colors';
import { useTranslation } from '@/hooks/use-translation';

export interface PlaceResult {
  placeId: string;
  name: string;
  fullDescription: string;
  country: string;
}

interface PlacesAutocompleteInputProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onSelect: (place: PlaceResult) => void;
  icon?: string;
  /** Dark mode for use inside dark modals (transport/hotel sheets) */
  dark?: boolean;
  /** Optional search type hint (passed to server for filtering) */
  searchTypes?: 'address' | 'establishment' | 'cities' | 'geocode' | 'mixed';
}

/**
 * A reusable Google Places autocomplete input.
 * Opens a full-screen search modal on tap for better UX inside bottom sheets.
 */
export function PlacesAutocompleteInput({
  label,
  placeholder,
  value,
  onSelect,
  icon = 'location-outline',
  dark = false,
  searchTypes,
}: PlacesAutocompleteInputProps) {
  const colors = useColors();
  const t = useTranslation();
  const defaultPlaceholder = placeholder || t.common.search + '...';
  const [modalVisible, setModalVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isFetching } = trpc.places.autocomplete.useQuery(
    { query: debouncedQuery, types: searchTypes },
    { enabled: debouncedQuery.length >= 2 }
  );

  const handleChangeText = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(text);
    }, 350);
  }, []);

  const handleSelect = useCallback((place: PlaceResult) => {
    setModalVisible(false);
    setQuery('');
    setDebouncedQuery('');
    onSelect(place);
  }, [onSelect]);

  const handleClose = () => {
    setModalVisible(false);
    setQuery('');
    setDebouncedQuery('');
  };

  const bg = dark ? 'rgba(255,255,255,0.08)' : colors.surface;
  const textColor = dark ? '#F0EBE0' : colors.foreground;
  const mutedColor = dark ? 'rgba(240,235,224,0.9)' : colors.muted;
  const borderColor = dark ? 'rgba(255,255,255,0.12)' : colors.border;

  const predictions = data?.predictions || [];

  return (
    <>
      {label && (
        <Text style={[styles.label, { color: mutedColor }]}>{label}</Text>
      )}
      <Pressable
        onPress={() => setModalVisible(true)}
        style={[styles.trigger, { backgroundColor: bg, borderColor }]}
      >
        <Ionicons name={icon as any} size={16} color={mutedColor} style={styles.triggerIcon} />
        <Text
          style={[styles.triggerText, { color: value ? textColor : mutedColor }]}
          numberOfLines={1}
        >
          {value || defaultPlaceholder}
        </Text>
        {value ? (
          <Ionicons name="checkmark-circle" size={16} color="#3D5A2E" />
        ) : (
          <Ionicons name="chevron-forward" size={14} color={mutedColor} />
        )}
      </Pressable>

      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleClose}
      >
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={handleClose} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: colors.primary }]}>{t.common.cancel}</Text>
            </Pressable>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {label || t.common.search}
            </Text>
            <View style={{ width: 70 }} />
          </View>

          {/* Search input */}
          <View style={[styles.searchRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="search" size={16} color={colors.muted} style={styles.searchIcon} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder={defaultPlaceholder}
              placeholderTextColor={colors.muted}
              value={query}
              onChangeText={handleChangeText}
              autoFocus
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="words"
            />
            {isFetching && <ActivityIndicator size="small" color={colors.primary} />}
            {query.length > 0 && !isFetching && (
              <Pressable onPress={() => { setQuery(''); setDebouncedQuery(''); }}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            )}
          </View>

          {/* Results */}
          {query.length >= 2 ? (
            <FlatList
              data={predictions}
              keyExtractor={(item) => item.placeId}
              keyboardShouldPersistTaps="always"
              contentContainerStyle={styles.resultsList}
              ListEmptyComponent={
                !isFetching ? (
                  <View style={styles.emptyRow}>
                    <Text style={[styles.emptyText, { color: colors.muted }]}>
                      {t.common.noResults}
                    </Text>
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handleSelect(item)}
                  style={({ pressed }) => [
                    styles.resultRow,
                    { borderBottomColor: colors.border },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={[styles.resultIcon, { backgroundColor: colors.surface }]}>
                    <Ionicons name="location-outline" size={16} color={colors.primary} />
                  </View>
                  <View style={styles.resultInfo}>
                    <Text style={[styles.resultName, { color: colors.foreground }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.resultDesc, { color: colors.muted }]} numberOfLines={1}>
                      {item.fullDescription}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.muted} />
                </Pressable>
              )}
            />
          ) : (
            <View style={styles.hintRow}>
              <Text style={[styles.hintText, { color: colors.muted }]}>
                {t.common.typeToSearch || 'Digite pelo menos 2 caracteres para buscar'}
              </Text>
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 16,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 10,
  },
  triggerIcon: {
    flexShrink: 0,
  },
  triggerText: {
    flex: 1,
    fontSize: 15,
  },
  modal: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: {
    width: 70,
  },
  cancelText: {
    fontSize: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  searchIcon: {},
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  resultsList: {
    paddingHorizontal: 16,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  resultIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '500',
  },
  resultDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  emptyRow: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
  hintRow: {
    paddingHorizontal: 24,
    paddingTop: 24,
    alignItems: 'center',
  },
  hintText: {
    fontSize: 14,
    textAlign: 'center',
  },
});

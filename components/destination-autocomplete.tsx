import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { trpc } from '@/lib/trpc';
import { useColors } from '@/hooks/use-colors';

interface Prediction {
  placeId: string;
  name: string;
  fullDescription: string;
  country: string;
}

interface DestinationAutocompleteProps {
  onSelect: (prediction: Prediction) => void;
  placeholder?: string;
}

export function DestinationAutocomplete({ onSelect, placeholder = 'Adicionar destino' }: DestinationAutocompleteProps) {
  const colors = useColors();
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const { data, isFetching } = trpc.places.autocomplete.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 }
  );

  const handleChangeText = useCallback((text: string) => {
    setQuery(text);
    setShowResults(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(text);
    }, 350);
  }, []);

  const handleSelect = useCallback((prediction: Prediction) => {
    setQuery('');
    setDebouncedQuery('');
    setShowResults(false);
    onSelect(prediction);
  }, [onSelect]);

  const predictions = data?.predictions || [];

  return (
    <View style={styles.container}>
      <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.icon, { color: colors.muted }]}>📍</Text>
        <TextInput
          style={[styles.input, { color: colors.foreground }]}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={handleChangeText}
          onFocus={() => setShowResults(true)}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="words"
        />
        {isFetching && <ActivityIndicator size="small" color={colors.textAccent} style={styles.loader} />}
      </View>

      {showResults && query.length >= 2 && (
        <View style={[styles.dropdown, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {predictions.length === 0 && !isFetching ? (
            <View style={styles.emptyRow}>
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                {query.length < 2 ? 'Digite pelo menos 2 caracteres' : 'Nenhum resultado encontrado'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={predictions}
              keyExtractor={(item) => item.placeId}
              keyboardShouldPersistTaps="always"
              scrollEnabled={predictions.length > 4}
              style={{ maxHeight: 220 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handleSelect(item)}
                  style={({ pressed }) => [
                    styles.resultRow,
                    { borderBottomColor: colors.border },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={[styles.resultName, { color: colors.foreground }]}>{item.name}</Text>
                  <Text style={[styles.resultCountry, { color: colors.muted }]}>{item.country}</Text>
                </Pressable>
              )}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 100,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 48,
  },
  icon: {
    fontSize: 16,
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  loader: {
    marginLeft: 8,
  },
  dropdown: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 8,
    overflow: 'hidden',
  },
  resultRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '500',
  },
  resultCountry: {
    fontSize: 12,
    marginTop: 2,
  },
  emptyRow: {
    padding: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
});

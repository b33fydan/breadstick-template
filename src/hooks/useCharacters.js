import { useState, useEffect } from 'react';
import { defaultCharacters } from '../data/characters';

const STORAGE_KEY = 'breadstick-characters';

// Migration: sync stored characters with any new defaults
function migrateCharacters(characters) {
  const migrated = [...characters];

  // Add any new default characters that aren't in stored data
  for (const defaultChar of defaultCharacters) {
    if (!migrated.some(c => c.id === defaultChar.id)) {
      migrated.push(defaultChar);
    }
  }

  return migrated;
}

export function useCharacters(initialActiveId = null) {
  const [characters, setCharacters] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return migrateCharacters(JSON.parse(stored));
      } catch {
        return defaultCharacters;
      }
    }
    return defaultCharacters;
  });

  const [activeId, setActiveId] = useState(() =>
    initialActiveId && characters.some((c) => c.id === initialActiveId)
      ? initialActiveId
      : characters[0]?.id || null
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(characters));
  }, [characters]);

  const activeCharacter = characters.find((c) => c.id === activeId) || null;

  const addCharacter = (character) => {
    const id = character.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const newChar = { ...character, id };
    setCharacters((prev) => [...prev, newChar]);
    setActiveId(id);
  };

  const deleteCharacter = (id) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(characters[0]?.id || null);
    }
  };

  const exportCharacters = () => {
    return JSON.stringify(characters, null, 2);
  };

  const importCharacters = (json) => {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        setCharacters(parsed);
        setActiveId(parsed[0]?.id || null);
      }
    } catch {
      console.error('Invalid character JSON');
    }
  };

  return {
    characters,
    activeId,
    activeCharacter,
    setActiveId,
    addCharacter,
    deleteCharacter,
    exportCharacters,
    importCharacters,
  };
}

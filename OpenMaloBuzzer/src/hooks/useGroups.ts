import {useState, useEffect} from 'react';
import {Group} from '../types';
import {subscribeToGroups} from '../services/firebase';

let cachedGroups: Group[] | null = null;

/** Clear the module-level cache. Must be called on logout to prevent data leaking between sessions. */
export const clearGroupCache = () => { cachedGroups = null; };

export const useGroups = () => {
  const [groups, setGroups] = useState<Group[]>(cachedGroups || []);
  const [loading, setLoading] = useState(cachedGroups === null);

  useEffect(() => {
    const unsubscribe = subscribeToGroups(g => {
      cachedGroups = g;
      setGroups(g);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return {groups, loading};
};

import {useState, useEffect} from 'react';
import {User} from '../types';
import {subscribeToUsers} from '../services/firebase';
import {PRESENCE_TIMEOUT_MS} from '../constants';

// Module-level cache so re-mounting HomeScreen doesn't flash a loading spinner
let cachedUsers: User[] | null = null;

/** Clear the module-level cache. Must be called on logout to prevent data leaking between sessions. */
export const clearUserCache = () => { cachedUsers = null; };

export const useUsers = (currentUserId: string | undefined) => {
  const [users, setUsers] = useState<User[]>(
    cachedUsers
      ? cachedUsers.filter(u => u.id !== currentUserId).sort((a, b) => a.name.localeCompare(b.name))
      : [],
  );
  const [loading, setLoading] = useState(cachedUsers === null);

  useEffect(() => {
    const unsubscribe = subscribeToUsers(allUsers => {
      cachedUsers = allUsers;
      setUsers(
        allUsers
          .filter(u => u.id !== currentUserId)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setLoading(false);
    });
    return unsubscribe;
  }, [currentUserId]);

  const isOnline = (user: User) =>
    Date.now() - user.last_seen_at < PRESENCE_TIMEOUT_MS;

  return {users, isOnline, loading};
};

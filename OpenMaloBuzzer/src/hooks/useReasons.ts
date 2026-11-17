import {useState, useEffect} from 'react';
import {Reason} from '../types';
import {subscribeToReasons} from '../services/firebase';

let cachedReasons: Reason[] | null = null;

/** Clear the module-level cache. Must be called on logout to prevent data leaking between sessions. */
export const clearReasonCache = () => { cachedReasons = null; };

export const useReasons = (tenantId?: string) => {
  const [reasons, setReasons] = useState<Reason[]>(cachedReasons || []);

  useEffect(() => {
    const unsubscribe = subscribeToReasons(data => {
      cachedReasons = data;
      setReasons(data);
    }, tenantId);
    return unsubscribe;
  }, [tenantId]);

  return reasons;
};

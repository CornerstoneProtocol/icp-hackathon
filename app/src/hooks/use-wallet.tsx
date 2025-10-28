import { useState, useEffect, useCallback } from 'react';
import { initAuth, login, logout, isAuthenticated, getPrincipal, getAccount } from '@/lib/icp';
import { Principal } from '@dfinity/principal';

export const useWallet = () => {
  const [account, setAccount] = useState<string | null>(null);
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if wallet is already connected on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        await initAuth();
        const authenticated = await isAuthenticated();
        
        if (authenticated) {
          const principalId = await getPrincipal();
          const accountId = await getAccount();
          
          if (principalId && accountId) {
            setPrincipal(principalId);
            setAccount(accountId);
          }
        }
      } catch (err) {
        console.error('Failed to check authentication:', err);
      }
    };

    checkConnection();
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      await login();
      
      // After successful login, get the identity
      const principalId = await getPrincipal();
      const accountId = await getAccount();
      
      if (principalId && accountId) {
        setPrincipal(principalId);
        setAccount(accountId);
      } else {
        throw new Error('Failed to get identity after login');
      }
    } catch (err: any) {
      const message = err?.message || 'Failed to connect with Internet Identity';
      setError(message);
      console.error('Authentication error:', err);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await logout();
      setAccount(null);
      setPrincipal(null);
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
  }, []);

  const formatAddress = (address: string) => {
    // ICP principals are longer, so we show more characters
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  };

  return {
    account,
    principal,
    isConnected: !!account,
    isConnecting,
    error,
    connect,
    disconnect,
    formatAddress: account ? formatAddress(account) : null,
  };
};
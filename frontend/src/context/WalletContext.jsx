import { createContext, useContext, useState, useEffect } from 'react';

const WalletContext = createContext();

export function WalletProvider({ children }) {
  const [isWalletValid, setIsWalletValid] = useState(false);
  const [walletAddress, setWalletAddress] = useState(null);
  const [telegramId, setTelegramId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // بررسی اعتبار ولت از localStorage
  useEffect(() => {
    const savedWallet = localStorage.getItem('valid_wallet');
    const savedTelegram = localStorage.getItem('telegram_id');
    
    if (savedWallet && savedTelegram) {
      setWalletAddress(savedWallet);
      setTelegramId(parseInt(savedTelegram));
      setIsWalletValid(true);
    }
    setIsLoading(false);
  }, []);

  const validateWallet = (address, tgId) => {
    const savedWallet = localStorage.getItem('valid_wallet');
    const savedTelegram = localStorage.getItem('telegram_id');
    
    // اگر ولت و تلگرام در localStorage ذخیره شده باشند
    if (savedWallet && savedTelegram) {
      const isValid = address === savedWallet && tgId === parseInt(savedTelegram);
      setIsWalletValid(isValid);
      return isValid;
    }
    
    // اگر هنوز ذخیره نشده، ولت جدید را ذخیره کن
    if (address && tgId) {
      localStorage.setItem('valid_wallet', address);
      localStorage.setItem('telegram_id', tgId);
      setWalletAddress(address);
      setTelegramId(tgId);
      setIsWalletValid(true);
      return true;
    }
    
    setIsWalletValid(false);
    return false;
  };

  const resetWallet = () => {
    localStorage.removeItem('valid_wallet');
    localStorage.removeItem('telegram_id');
    setIsWalletValid(false);
    setWalletAddress(null);
    setTelegramId(null);
  };

  return (
    <WalletContext.Provider value={{
      isWalletValid,
      walletAddress,
      telegramId,
      isLoading,
      validateWallet,
      resetWallet,
      setIsWalletValid
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
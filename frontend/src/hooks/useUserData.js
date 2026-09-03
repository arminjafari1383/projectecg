import { cookieUtils } from "../utils/cookie";
import {
  loadUserData,
  saveUserData as persistUserData,
  clearUserData as wipeUserData,
} from "../utils/userStorage";

export function useUserData() {
  const saveUserData = (data) => persistUserData(data);
  const clearUserData = () => wipeUserData();

  return {
    userData: loadUserData() || {
      walletAddress: null,
      telegramId: null,
      telegramUsername: null,
      isTelegram: false,
    },
    saveUserData,
    loadUserData,
    clearUserData,
    hasUserData: () => Boolean(loadUserData()) || cookieUtils.hasCookie("user_data"),
  };
}

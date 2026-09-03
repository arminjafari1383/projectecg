import { useEffect } from "react";
import { captureInviterCode } from "../utils/referral";

export default function useTgStartRedirect() {
  useEffect(() => {
    captureInviterCode();
  }, []);
}

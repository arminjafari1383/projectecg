import axios from "axios";

const baseURL =
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== "undefined" ? `${window.location.origin}/api/` : "/api/");

export const api = axios.create({
  baseURL,
  timeout: 30000,
});

const IDEMPOTENT_METHODS = new Set(["get", "head", "options"]);

api.interceptors.response.use(
  (response) => response,

  async (error) => {
    const { config, message, code } = error;

    if (
      config &&
      IDEMPOTENT_METHODS.has(String(config.method || "get").toLowerCase()) &&
      (message === "Network Error" ||
        code === "ERR_NETWORK" ||
        code === "ECONNABORTED")
    ) {
      config.retryCount = config.retryCount || 0;

      if (config.retryCount < 3) {
        config.retryCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return api(config);
      }
    }

    return Promise.reject(error);
  }
);

export default api;

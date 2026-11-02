import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL } from "../../config";

const API = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

API.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

API.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error?.response?.status === 401) {
      const msg = String(error?.response?.data?.message || "");
      if (msg.includes("token failed") || msg.includes("Not authorized")) {
        await AsyncStorage.multiRemove(["token", "userId", "user", "userName"]);
      }
    }
    return Promise.reject(error);
  }
);

export default API;
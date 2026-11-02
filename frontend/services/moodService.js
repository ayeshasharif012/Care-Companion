import axios from "axios";
import { API_URL } from "../config";

export const getMood = async (userId, days = 7) => {
  try {
    const response = await axios.get(`${API_URL}/mood/${userId}?days=${days}`);
    return response.data;
  } catch (err) {
    console.error("Mood fetch error:", err);
    return null;
  }
};

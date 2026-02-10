import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        soft: "0 12px 40px rgba(2,6,23,0.10)"
      }
    }
  },
  plugins: [typography]
} satisfies Config;
